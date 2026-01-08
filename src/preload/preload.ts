import { contextBridge, ipcRenderer } from "electron";
import {
  CaptureSnapshotResult,
  CaptureTarget,
  EventLog,
  OverlayAPI,
  OverlayPlan,
  OverlaySettings
} from "../shared/ipc";

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.trim();
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const api: OverlayAPI = {
  getSettings: () => ipcRenderer.invoke("app:get-settings"),
  saveSettings: (settings: OverlaySettings) => ipcRenderer.invoke("app:save-settings", settings),
  getDisplays: () => ipcRenderer.invoke("app:get-displays"),
  setDisplay: (displayId: number) => ipcRenderer.invoke("app:set-display", displayId),
  loadPlan: () => ipcRenderer.invoke("plan:load"),
  savePlan: (plan: OverlayPlan) => ipcRenderer.invoke("plan:save", plan),
  loadEventLog: () => ipcRenderer.invoke("event-log:load"),
  saveEventLog: (log: EventLog) => ipcRenderer.invoke("event-log:save", log),
  listCaptureSources: async () => {
    try {
      return await ipcRenderer.invoke("capture:list-sources");
    } catch (error: unknown) {
      console.error("[capture] listCaptureSources failed", error);
      throw new Error(`listCaptureSources failed: ${formatError(error)}`);
    }
  },
  captureAndProcess: async (target) => {
    try {
      return await ipcRenderer.invoke("capture:request", target);
    } catch (error: unknown) {
      console.error("[capture] captureAndProcess failed", error);
      throw new Error(`captureAndProcess failed: ${formatError(error)}`);
    }
  },
  captureSnapshot: async (target: CaptureTarget): Promise<CaptureSnapshotResult> => {
    try {
      return await ipcRenderer.invoke("capture:snapshot", target);
    } catch (error: unknown) {
      console.error("[capture] captureSnapshot failed", error);
      throw new Error(`captureSnapshot failed: ${formatError(error)}`);
    }
  },
  stopCapture: () => {
    // Main-process capture is stateless; nothing to stop.
  },
  onEscapeHatch: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:escape-hatch", listener);
    return () => ipcRenderer.removeListener("app:escape-hatch", listener);
  }
};

contextBridge.exposeInMainWorld("overlayAPI", api);
