import { app, BrowserWindow, ipcMain, screen, globalShortcut } from "electron";
import { join } from "path";
import { loadPlan, loadSettings, savePlan, saveSettings } from "./storage";
import { DisplayInfo, OverlayPlan, OverlaySettings } from "../shared/ipc";

let overlayWindow: BrowserWindow | null = null;
let cachedSettings: OverlaySettings | null = null;

const escapeShortcut = "Control+Shift+O";

const getDisplays = (): DisplayInfo[] => {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `Display ${index + 1} (${display.size.width}x${display.size.height})`,
    bounds: display.bounds
  }));
};

const resolveBounds = (settings: OverlaySettings): Electron.Rectangle => {
  if (settings.bounds) {
    return settings.bounds;
  }
  const primary = screen.getPrimaryDisplay();
  return {
    x: primary.bounds.x + 50,
    y: primary.bounds.y + 50,
    width: Math.round(primary.bounds.width * 0.6),
    height: Math.round(primary.bounds.height * 0.6)
  };
};

const applyClickThrough = (window: BrowserWindow, enabled: boolean) => {
  window.setIgnoreMouseEvents(enabled, { forward: true });
};

const positionOnDisplay = (window: BrowserWindow, displayId: number | null) => {
  const displays = screen.getAllDisplays();
  const target = displays.find((display) => display.id === displayId) ?? screen.getPrimaryDisplay();
  const bounds = window.getBounds();
  const nextBounds = {
    x: target.bounds.x + 40,
    y: target.bounds.y + 40,
    width: bounds.width,
    height: bounds.height
  };
  window.setBounds(nextBounds);
};

const rectsIntersect = (a: Electron.Rectangle, b: Electron.Rectangle) => {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
};

const boundsEqual = (a: Electron.Rectangle, b: Electron.Rectangle) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const createOverlayWindow = async () => {
  cachedSettings = await loadSettings();
  const bounds = resolveBounds(cachedSettings);

  overlayWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, "..", "preload", "preload.js"),
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setOpacity(cachedSettings.opacity);
  applyClickThrough(overlayWindow, cachedSettings.clickThrough);

  if (cachedSettings.displayId !== null) {
    const displays = screen.getAllDisplays();
    const target =
      displays.find((display) => display.id === cachedSettings.displayId) ?? screen.getPrimaryDisplay();
    const currentBounds = overlayWindow.getBounds();
    const hasSavedBounds = Boolean(cachedSettings.bounds);
    const alreadyOnTargetDisplay = rectsIntersect(currentBounds, target.bounds);
    if (!hasSavedBounds || !alreadyOnTargetDisplay) {
      positionOnDisplay(overlayWindow, cachedSettings.displayId);
    }
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await overlayWindow.loadURL(devServerUrl);
  } else {
    await overlayWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }

  const persistBounds = async () => {
    if (!overlayWindow || !cachedSettings) {
      return;
    }
    cachedSettings.bounds = overlayWindow.getBounds();
    await saveSettings(cachedSettings);
  };

  let boundsTimer: NodeJS.Timeout | null = null;
  let boundsInterval: NodeJS.Timeout | null = null;
  const schedulePersist = () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
    }
    boundsTimer = setTimeout(() => {
      persistBounds().catch(() => undefined);
    }, 400);
  };

  overlayWindow.on("move", schedulePersist);
  overlayWindow.on("moved", schedulePersist);
  overlayWindow.on("will-move", schedulePersist);
  overlayWindow.on("resize", schedulePersist);

  boundsInterval = setInterval(() => {
    if (!overlayWindow || !cachedSettings) {
      return;
    }
    const currentBounds = overlayWindow.getBounds();
    if (!cachedSettings.bounds || !boundsEqual(cachedSettings.bounds, currentBounds)) {
      cachedSettings.bounds = currentBounds;
      saveSettings(cachedSettings).catch(() => undefined);
    }
  }, 1000);

  overlayWindow.on("close", () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
      boundsTimer = null;
    }
    if (boundsInterval) {
      clearInterval(boundsInterval);
      boundsInterval = null;
    }
    persistBounds().catch(() => undefined);
  });

  globalShortcut.register(escapeShortcut, () => {
    if (!overlayWindow || !cachedSettings) {
      return;
    }
    cachedSettings.clickThrough = false;
    applyClickThrough(overlayWindow, false);
    overlayWindow.focus();
    overlayWindow.webContents.send("app:escape-hatch");
    saveSettings(cachedSettings).catch(() => undefined);
  });
};

const registerIpc = () => {
  ipcMain.handle("app:get-settings", async () => {
    cachedSettings = cachedSettings ?? (await loadSettings());
    return cachedSettings;
  });

  ipcMain.handle("app:save-settings", async (_event, settings: OverlaySettings) => {
    cachedSettings = settings;
    await saveSettings(settings);
    if (overlayWindow) {
      overlayWindow.setOpacity(settings.opacity);
      applyClickThrough(overlayWindow, settings.clickThrough);
    }
  });

  ipcMain.handle("app:get-displays", async () => getDisplays());

  ipcMain.handle("app:set-display", async (_event, displayId: number) => {
    cachedSettings = cachedSettings ?? (await loadSettings());
    cachedSettings.displayId = displayId;
    await saveSettings(cachedSettings);
    if (overlayWindow) {
      positionOnDisplay(overlayWindow, displayId);
    }
  });

  ipcMain.handle("plan:load", async () => loadPlan());

  ipcMain.handle("plan:save", async (_event, plan: OverlayPlan) => {
    await savePlan(plan);
  });
};

app.on("ready", async () => {
  registerIpc();
  await createOverlayWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregister(escapeShortcut);
});
