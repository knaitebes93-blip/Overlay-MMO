use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod commands;

const DEFAULT_SAMPLING_INTERVAL: u64 = 10;

#[derive(Clone)]
pub struct ManualValueProvider {
    values: Arc<Mutex<Option<ManualValues>>>,
}

impl ManualValueProvider {
    pub fn new() -> Self {
        Self {
            values: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_values(&self, values: ManualValues) {
        let mut guard = self.values.lock().unwrap();
        *guard = Some(values);
    }
}

impl ValueProvider for ManualValueProvider {
    fn get_values(&self) -> Option<ManualValues> {
        self.values.lock().unwrap().clone()
    }
}

pub trait ValueProvider: Send + Sync {
    fn get_values(&self) -> Option<ManualValues>;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ManualValues {
    pub level: i32,
    pub exp_percent: f64,
}

pub struct SamplerHandle {
    pub stop_flag: Arc<std::sync::atomic::AtomicBool>,
    pub join_handle: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub sampling_interval_sec: Arc<AtomicU64>,
    pub active_spot_id: Arc<Mutex<Option<String>>>,
    pub manual_provider: Arc<ManualValueProvider>,
    pub value_provider: Arc<dyn ValueProvider>,
    pub sampler: Arc<Mutex<Option<SamplerHandle>>>,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Self {
        let manual_provider = Arc::new(ManualValueProvider::new());
        Self {
            db_path,
            sampling_interval_sec: Arc::new(AtomicU64::new(DEFAULT_SAMPLING_INTERVAL)),
            active_spot_id: Arc::new(Mutex::new(None)),
            value_provider: manual_provider.clone(),
            manual_provider,
            sampler: Arc::new(Mutex::new(None)),
        }
    }

    pub fn initialize_defaults(&self) {
        // If settings are present in the database, hydrate the in-memory defaults.
        if let Ok(Some(interval)) = commands::get_setting(&self.db_path, "sampling_interval_sec") {
            if let Ok(parsed) = interval.parse::<u64>() {
                self.sampling_interval_sec
                    .store(parsed.max(1), Ordering::SeqCst);
            }
        }

        if let Ok(Some(active_spot)) = commands::get_setting(&self.db_path, "active_spot_id") {
            let mut guard = self.active_spot_id.lock().unwrap();
            *guard = Some(active_spot);
        }
    }
}

#[derive(Serialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WidgetRect {
    pub id: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileData {
    pub selectedMonitorId: String,
    pub widgets: Vec<WidgetRect>,
}

pub(crate) fn profiles_dir() -> PathBuf {
    // Keep profiles alongside the application so JSON files are easy to inspect/edit.
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("profiles")
}

fn db_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("overlay.db")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = db_path();
    let app_state = AppState::new(db_path.clone());

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:overlay.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "create tables",
                            sql: r#"
                            CREATE TABLE IF NOT EXISTS timers (
                              id TEXT PRIMARY KEY,
                              name TEXT NOT NULL,
                              ends_at INTEGER NOT NULL,
                              created_at INTEGER NOT NULL
                            );
                            CREATE TABLE IF NOT EXISTS counters (
                              id TEXT PRIMARY KEY,
                              name TEXT NOT NULL,
                              value INTEGER NOT NULL,
                              created_at INTEGER NOT NULL
                            );
                            CREATE TABLE IF NOT EXISTS notes (
                              id TEXT PRIMARY KEY,
                              content TEXT NOT NULL,
                              created_at INTEGER NOT NULL
                            );
                            CREATE TABLE IF NOT EXISTS spot_sessions (
                              id TEXT PRIMARY KEY,
                              spot_name TEXT NOT NULL,
                              character_level INTEGER NOT NULL,
                              exp_start INTEGER NOT NULL,
                              exp_end INTEGER,
                              exp_to_next_level INTEGER,
                              started_at INTEGER NOT NULL,
                              ended_at INTEGER,
                              duration_seconds INTEGER
                            );
                            "#,
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "exp tracking tables",
                            sql: r#"
                            CREATE TABLE IF NOT EXISTS spots (
                              id TEXT PRIMARY KEY,
                              name TEXT NOT NULL UNIQUE,
                              created_at INTEGER NOT NULL
                            );
                            CREATE TABLE IF NOT EXISTS exp_samples (
                              id TEXT PRIMARY KEY,
                              spot_id TEXT NOT NULL,
                              ts INTEGER NOT NULL,
                              level INTEGER NOT NULL,
                              exp_percent REAL NOT NULL,
                              FOREIGN KEY(spot_id) REFERENCES spots(id)
                            );
                            CREATE INDEX IF NOT EXISTS idx_exp_samples_spot_ts ON exp_samples(spot_id, ts);
                            CREATE TABLE IF NOT EXISTS exp_settings (
                              key TEXT PRIMARY KEY,
                              value TEXT NOT NULL
                            );
                            "#,
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .setup(move |app| {
            let managed_state = app_state.clone();
            managed_state.initialize_defaults();
            app.manage(managed_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_monitors,
            commands::read_profile,
            commands::write_profile,
            commands::upsert_spot,
            commands::list_spots,
            commands::set_active_spot,
            commands::get_active_spot,
            commands::set_sampling_interval_sec,
            commands::get_sampling_interval_sec,
            commands::record_exp_sample,
            commands::list_exp_samples,
            commands::compute_spot_rate,
            commands::list_spot_rates,
            commands::start_sampler,
            commands::stop_sampler,
            commands::is_sampler_running,
            commands::set_manual_values,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
