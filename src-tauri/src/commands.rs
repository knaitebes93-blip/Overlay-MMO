use std::fs;

use tauri::AppHandle;

use crate::{profiles_dir, MonitorInfo, ProfileData};

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
            let id = name_opt
                .clone()
                .unwrap_or_else(|| format!("monitor-{idx}"));

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
