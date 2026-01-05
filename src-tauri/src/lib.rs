#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

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

fn profiles_dir() -> PathBuf {
    // Keep profiles alongside the application so JSON files are easy to inspect/edit.
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("profiles")
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("failed to enumerate monitors: {e}"))?;

    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(idx, monitor)| MonitorInfo {
            id: monitor
                .name()
                .unwrap_or_else(|| format!("monitor-{idx}")),
            name: monitor.name(),
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect())
}

#[tauri::command]
pub fn read_profile(app: AppHandle, profile_name: String) -> Result<ProfileData, String> {
    let dir = profiles_dir();
    let path = dir.join(format!("{profile_name}.json"));
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read profile {}: {e}", path.display()))?;
    serde_json::from_str(&contents).map_err(|e| format!("invalid profile json: {e}"))
}

#[tauri::command]
pub fn write_profile(app: AppHandle, profile_name: String, data: ProfileData) -> Result<(), String> {
    let dir = profiles_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create profile directory: {e}"))?;
    let path = dir.join(format!("{profile_name}.json"));
    let contents = serde_json::to_string_pretty(&data).map_err(|e| format!("failed to serialize profile: {e}"))?;
    fs::write(&path, contents).map_err(|e| format!("failed to write profile {}: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            read_profile,
            write_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
