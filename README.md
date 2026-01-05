# Overlay MMO

Overlay MMO is a lightweight, always-on-top overlay built with Tauri v2 (React + TypeScript). Phase 0 focuses on a monitor-based game area with draggable widgets and a minimal profile system.

## Features
- Transparent overlay window that stays on top of games.
- Edit and Run modes: edit exposes drag/resize handles, run makes the overlay click-through.
- Draggable/resizable widgets using `react-rnd`:
  - ClockWidget (1 Hz refresh)
  - StatusWidget (static demo data)
- Settings window for monitor discovery and selection (defines the game area).
- Layout stored as relative coordinates per selected monitor; profiles saved as JSON under `profiles/`.
- Tauri backend commands to list monitors and read/write profiles.

## Getting started
### Prerequisites
- Node.js 18+
- Rust toolchain (with `cargo`)
- Tauri CLI (`npm install -g @tauri-apps/cli` if not already available)

### Install dependencies
```
npm install
```

### Run in development
Start the Vite dev server and Tauri shell:
```
npm run tauri dev
```
The overlay window starts in edit mode. Use **Settings** to pick a monitor and load the `example` profile.

### Build
```
npm run tauri build
```
The build output targets Windows first but will compile on other platforms supported by Tauri.

## Project structure
- `src/`: React front-end (overlay and settings UI)
- `src-tauri/`: Tauri v2 backend (Rust commands and window config)
- `profiles/`: JSON profiles stored as relative widget layouts (sample `example.json` included)

## Profile format
```
{
  "selectedMonitorId": "monitor-0",
  "widgets": [
    { "id": "clock", "type": "clock", "x": 0.05, "y": 0.05, "width": 0.12, "height": 0.1 },
    { "id": "status", "type": "status", "x": 0.25, "y": 0.05, "width": 0.18, "height": 0.12 }
  ]
}
```
Coordinates and sizes are relative (0..1) to the chosen monitor bounds.
