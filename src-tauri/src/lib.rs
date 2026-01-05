use serde::{Deserialize, Serialize};
use std::path::PathBuf;

mod commands;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_monitors,
            commands::read_profile,
            commands::write_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
