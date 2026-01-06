use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{profiles_dir, AppState, ManualValues, MonitorInfo, ProfileData};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Spot {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ExpSample {
    pub id: String,
    pub spot_id: String,
    pub ts: i64,
    pub level: i32,
    pub exp_percent: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SpotRate {
    pub spot_id: String,
    pub spot_name: String,
    pub exp_per_hour: f64,
    pub sample_count: usize,
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    Connection::open(db_path)
        .map_err(|e| format!("failed to open database {}: {e}", db_path.display()))
}

pub fn get_setting(db_path: &Path, key: &str) -> Result<Option<String>, String> {
    let conn = open_connection(db_path)?;
    conn.query_row(
        "SELECT value FROM exp_settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("failed to read setting {key}: {e}"))
}

fn set_setting(db_path: &Path, key: &str, value: &str) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute(
        "INSERT INTO exp_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("failed to write setting {key}: {e}"))?;
    Ok(())
}

fn to_spot(row: &rusqlite::Row<'_>) -> rusqlite::Result<Spot> {
    Ok(Spot {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
    })
}

fn to_sample(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExpSample> {
    Ok(ExpSample {
        id: row.get(0)?,
        spot_id: row.get(1)?,
        ts: row.get(2)?,
        level: row.get(3)?,
        exp_percent: row.get(4)?,
    })
}

fn fetch_spot(db_path: &Path, spot_id: &str) -> Result<Option<Spot>, String> {
    let conn = open_connection(db_path)?;
    conn.query_row(
        "SELECT id, name, created_at FROM spots WHERE id = ?1",
        [spot_id],
        to_spot,
    )
    .optional()
    .map_err(|e| format!("failed to load spot {spot_id}: {e}"))
}

fn fetch_spot_by_name(db_path: &Path, name: &str) -> Result<Option<Spot>, String> {
    let conn = open_connection(db_path)?;
    conn.query_row(
        "SELECT id, name, created_at FROM spots WHERE name = ?1",
        [name],
        to_spot,
    )
    .optional()
    .map_err(|e| format!("failed to load spot {name}: {e}"))
}

fn load_spots(db_path: &Path) -> Result<Vec<Spot>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM spots ORDER BY created_at DESC")
        .map_err(|e| format!("failed to prepare spots query: {e}"))?;
    let rows = stmt
        .query_map([], to_spot)
        .map_err(|e| format!("failed to iterate spots: {e}"))?;
    let mut spots = Vec::new();
    for row in rows {
        spots.push(row.map_err(|e| format!("failed to parse spot: {e}"))?);
    }
    Ok(spots)
}

fn insert_sample(
    db_path: &Path,
    spot_id: &str,
    level: i32,
    exp_percent: f64,
    ts: i64,
) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute(
        "INSERT INTO exp_samples (id, spot_id, ts, level, exp_percent) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![Uuid::new_v4().to_string(), spot_id, ts, level, exp_percent],
    )
    .map_err(|e| format!("failed to insert exp sample: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("failed to enumerate monitors: {e}"))?;

    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(idx, monitor)| {
            let name_opt = monitor.name().cloned();
            let id = name_opt.clone().unwrap_or_else(|| format!("monitor-{idx}"));

            MonitorInfo {
                id,
                name: name_opt,
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
            }
        })
        .collect())
}

#[tauri::command]
pub fn read_profile(_app: AppHandle, profile_name: String) -> Result<ProfileData, String> {
    let dir = profiles_dir();
    let path = dir.join(format!("{profile_name}.json"));
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read profile {}: {e}", path.display()))?;
    serde_json::from_str(&contents).map_err(|e| format!("invalid profile json: {e}"))
}

#[tauri::command]
pub fn write_profile(
    _app: AppHandle,
    profile_name: String,
    data: ProfileData,
) -> Result<(), String> {
    let dir = profiles_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create profile directory: {e}"))?;
    let path = dir.join(format!("{profile_name}.json"));
    let contents = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("failed to serialize profile: {e}"))?;
    fs::write(&path, contents)
        .map_err(|e| format!("failed to write profile {}: {e}", path.display()))
}

#[tauri::command]
pub async fn upsert_spot(state: State<'_, AppState>, name: String) -> Result<Spot, String> {
    if let Some(existing) = fetch_spot_by_name(&state.db_path, &name)? {
        return Ok(existing);
    }

    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp_millis();
    let conn = open_connection(&state.db_path)?;
    conn.execute(
        "INSERT INTO spots (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, created_at],
    )
    .map_err(|e| format!("failed to insert spot: {e}"))?;

    Ok(Spot {
        id,
        name,
        created_at,
    })
}

#[tauri::command]
pub async fn list_spots(state: State<'_, AppState>) -> Result<Vec<Spot>, String> {
    load_spots(&state.db_path)
}

#[tauri::command]
pub async fn set_active_spot(state: State<'_, AppState>, spot_id: String) -> Result<(), String> {
    if fetch_spot(&state.db_path, &spot_id)?.is_none() {
        return Err("spot not found".into());
    }
    set_setting(&state.db_path, "active_spot_id", &spot_id)?;
    let mut guard = state.active_spot_id.lock().unwrap();
    *guard = Some(spot_id);
    Ok(())
}

#[tauri::command]
pub async fn get_active_spot(state: State<'_, AppState>) -> Result<Option<Spot>, String> {
    let active = state.active_spot_id.lock().unwrap().clone();
    if let Some(id) = active {
        return fetch_spot(&state.db_path, &id);
    }
    Ok(None)
}

#[tauri::command]
pub async fn set_sampling_interval_sec(
    state: State<'_, AppState>,
    value: u64,
) -> Result<(), String> {
    let clamped = value.max(1);
    state.sampling_interval_sec.store(clamped, Ordering::SeqCst);
    set_setting(
        &state.db_path,
        "sampling_interval_sec",
        &clamped.to_string(),
    )
}

#[tauri::command]
pub async fn get_sampling_interval_sec(state: State<'_, AppState>) -> Result<u64, String> {
    Ok(state.sampling_interval_sec.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn record_exp_sample(
    state: State<'_, AppState>,
    spot_id: String,
    level: i32,
    exp_percent: f64,
    ts: Option<i64>,
) -> Result<(), String> {
    let timestamp = ts.unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    insert_sample(&state.db_path, &spot_id, level, exp_percent, timestamp)
}

#[tauri::command]
pub async fn list_exp_samples(
    state: State<'_, AppState>,
    spot_id: String,
    limit: u32,
) -> Result<Vec<ExpSample>, String> {
    let conn = open_connection(&state.db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, spot_id, ts, level, exp_percent FROM exp_samples WHERE spot_id = ?1 ORDER BY ts DESC LIMIT ?2",
        )
        .map_err(|e| format!("failed to prepare samples query: {e}"))?;
    let rows = stmt
        .query_map(params![spot_id, limit], to_sample)
        .map_err(|e| format!("failed to iterate samples: {e}"))?;
    let mut samples = Vec::new();
    for row in rows {
        samples.push(row.map_err(|e| format!("failed to parse sample: {e}"))?);
    }
    Ok(samples)
}

fn compute_rate_for_samples(spot: &Spot, samples: &[ExpSample]) -> Option<SpotRate> {
    if samples.len() < 2 {
        return None;
    }
    let base_level = samples.first()?.level;
    let filtered: Vec<&ExpSample> = samples.iter().filter(|s| s.level == base_level).collect();
    if filtered.len() < 2 {
        return None;
    }
    let mut total_delta = 0.0_f64;
    for window in filtered.windows(2) {
        if let [first, second] = window {
            let delta = second.exp_percent - first.exp_percent;
            if delta > 0.0 {
                total_delta += delta;
            }
        }
    }
    let duration_ms = filtered.last()?.ts - filtered.first()?.ts;
    if duration_ms <= 0 {
        return None;
    }
    let hours = duration_ms as f64 / 3_600_000.0;
    if hours <= 0.0 {
        return None;
    }
    Some(SpotRate {
        spot_id: spot.id.clone(),
        spot_name: spot.name.clone(),
        exp_per_hour: total_delta / hours,
        sample_count: filtered.len(),
    })
}

fn load_recent_samples(
    db_path: &Path,
    spot_id: &str,
    window_minutes: u32,
) -> Result<Vec<ExpSample>, String> {
    let cutoff = chrono::Utc::now().timestamp_millis() - (window_minutes as i64) * 60_000;
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, spot_id, ts, level, exp_percent FROM exp_samples WHERE spot_id = ?1 AND ts >= ?2 ORDER BY ts ASC",
        )
        .map_err(|e| format!("failed to prepare rate query: {e}"))?;
    let rows = stmt
        .query_map(params![spot_id, cutoff], to_sample)
        .map_err(|e| format!("failed to iterate rate samples: {e}"))?;
    let mut samples = Vec::new();
    for row in rows {
        samples.push(row.map_err(|e| format!("failed to parse rate sample: {e}"))?);
    }
    Ok(samples)
}

#[tauri::command]
pub async fn compute_spot_rate(
    state: State<'_, AppState>,
    spot_id: String,
    window_minutes: u32,
) -> Result<Option<SpotRate>, String> {
    let spot = match fetch_spot(&state.db_path, &spot_id)? {
        Some(spot) => spot,
        None => return Ok(None),
    };
    let samples = load_recent_samples(&state.db_path, &spot_id, window_minutes)?;
    Ok(compute_rate_for_samples(&spot, &samples))
}

#[tauri::command]
pub async fn list_spot_rates(
    state: State<'_, AppState>,
    window_minutes: u32,
) -> Result<Vec<SpotRate>, String> {
    let spots = load_spots(&state.db_path)?;
    let mut rates = Vec::new();
    for spot in spots {
        let samples = load_recent_samples(&state.db_path, &spot.id, window_minutes)?;
        if let Some(rate) = compute_rate_for_samples(&spot, &samples) {
            rates.push(rate);
        }
    }
    rates.sort_by(|a, b| {
        b.exp_per_hour
            .partial_cmp(&a.exp_per_hour)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(rates)
}

async fn record_sample_from_provider(app_state: AppState) {
    let spot_id = { app_state.active_spot_id.lock().unwrap().clone() };
    let Some(spot_id) = spot_id else {
        return;
    };
    let Some(values) = app_state.value_provider.get_values() else {
        return;
    };
    let _ = insert_sample(
        &app_state.db_path,
        &spot_id,
        values.level,
        values.exp_percent,
        chrono::Utc::now().timestamp_millis(),
    );
}

#[tauri::command]
pub async fn start_sampler(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.sampler.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }
    let stop_flag = Arc::new(AtomicBool::new(false));
    let state_clone = state.clone();
    let loop_flag = stop_flag.clone();
    let handle = tauri::async_runtime::spawn(async move {
        loop {
            if loop_flag.load(Ordering::Relaxed) {
                break;
            }
            record_sample_from_provider(state_clone.clone()).await;
            let interval = state_clone
                .sampling_interval_sec
                .load(Ordering::SeqCst)
                .max(1);
            tauri::async_runtime::sleep(Duration::from_secs(interval)).await;
        }
    });
    *guard = Some(crate::SamplerHandle {
        stop_flag,
        join_handle: handle,
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_sampler(state: State<'_, AppState>) -> Result<(), String> {
    let handle = {
        let mut guard = state.sampler.lock().unwrap();
        guard.take()
    };
    if let Some(handle) = handle {
        handle.stop_flag.store(true, Ordering::SeqCst);
        let _ = handle.join_handle.await;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_sampler_running(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.sampler.lock().unwrap().is_some())
}

#[tauri::command]
pub async fn set_manual_values(
    state: State<'_, AppState>,
    level: i32,
    exp_percent: f64,
) -> Result<(), String> {
    state
        .manual_provider
        .set_values(ManualValues { level, exp_percent });
    Ok(())
}
