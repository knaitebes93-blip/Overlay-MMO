import { contextBridge, ipcRenderer } from "electron";
import { EventLog, OverlayAPI, OverlayPlan, OverlaySettings } from "../shared/ipc";

const api: OverlayAPI = {
  getSettings: () => ipcRenderer.invoke("app:get-settings"),
  saveSettings: (settings: OverlaySettings) => ipcRenderer.invoke("app:save-settings", settings),
  getDisplays: () => ipcRenderer.invoke("app:get-displays"),
  setDisplay: (displayId: number) => ipcRenderer.invoke("app:set-display", displayId),
  loadPlan: () => ipcRenderer.invoke("plan:load"),
  savePlan: (plan: OverlayPlan) => ipcRenderer.invoke("plan:save", plan),
  loadEventLog: () => ipcRenderer.invoke("event-log:load"),
  saveEventLog: (log: EventLog) => ipcRenderer.invoke("event-log:save", log),
  onEscapeHatch: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:escape-hatch", listener);
    return () => ipcRenderer.removeListener("app:escape-hatch", listener);
  }
};

contextBridge.exposeInMainWorld("overlayAPI", api);
