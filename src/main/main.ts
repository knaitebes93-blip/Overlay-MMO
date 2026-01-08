import { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeImage } from "electron";
import { join } from "path";
import {
  addMemoryEntry,
  deleteMemoryEntry,
  loadEventLog,
  loadMemory,
  loadPlan,
  loadRules,
  loadSettings,
  rollbackPlan,
  redoPlan,
  saveCapture,
  saveEventLog,
  saveMemory,
  savePlan,
  saveRules,
  saveSettings,
  undoPlan
} from "./storage";
import {
  CaptureSource,
  CaptureRoi,
  CaptureSnapshotResult,
  CaptureTarget,
  DisplayInfo,
  EventLog,
  MemoryEntry,
  MemoryStore,
  OcrResult,
  OverlayPlan,
  OverlaySettings,
  PlannerComposeInput,
  PlanSaveMeta,
  RulesStore
} from "../shared/ipc";
import { runOcr, shutdownOcrWorker } from "./ocr";
import * as ocrPreprocess from "./ocrPreprocess";
import { logError, logInfo } from "./logging";
import { composeWithLlm } from "./llmComposer";
import screenshotDesktop from "screenshot-desktop";
import { execFile } from "child_process";

let overlayWindow: BrowserWindow | null = null;
let cachedSettings: OverlaySettings | null = null;

const escapeShortcut = "Control+Shift+O";
const OCR_MAX_WIDTH = 1920;
const OCR_MAX_HEIGHT = 1080;
const OCR_UPSCALE_TARGET_LONG_SIDE = 1400;
const OCR_UPSCALE_MAX = 2.5;
const OCR_TEXT_LIMIT = 2000;
const OCR_PREVIEW_LIMIT = 140;
const OVERLAY_HIDE_DELAY_MS = 120;

const WINDOW_LIST_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Window {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$windows = New-Object System.Collections.Generic.List[object]
[Win32Window]::EnumWindows({ param($hWnd, $lParam)
  if (-not [Win32Window]::IsWindowVisible($hWnd)) { return $true }
  $len = [Win32Window]::GetWindowTextLength($hWnd)
  $sb = New-Object System.Text.StringBuilder ([Math]::Max($len, 1) + 1)
  [Win32Window]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
  $title = $sb.ToString()
  $pid = 0
  [Win32Window]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
  $processName = ""
  try { $processName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch { $processName = "" }
  if ([string]::IsNullOrWhiteSpace($title)) { $title = $processName }
  if ([string]::IsNullOrWhiteSpace($title)) { $title = "Window $($hWnd.ToInt64())" }
  if ($title -match "Program Manager" -or $title -match "Desktop Window Manager" -or $title -match "Overlay MMO") { return $true }
  $rect = New-Object Win32Window+RECT
  [Win32Window]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
  $windows.Add([pscustomobject]@{
    id = $hWnd.ToInt64()
    name = $title
    processName = $processName
    bounds = @{
      x = $rect.Left
      y = $rect.Top
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    }
  }) | Out-Null
  return $true
}, [IntPtr]::Zero) | Out-Null
$windows | ConvertTo-Json -Compress
`.trim();

const WINDOW_CAPTURE_SCRIPT = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Capture {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$hwnd = [IntPtr]::new($Id)
$rect = New-Object Win32Capture+RECT
$okRect = [Win32Capture]::GetWindowRect($hwnd, [ref]$rect)
if (-not $okRect) { throw "GetWindowRect failed" }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "Window has invalid bounds" }
$bmp = New-Object System.Drawing.Bitmap $width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
$flags = 2
$ok = [Win32Capture]::PrintWindow($hwnd, $hdc, $flags)
$gfx.ReleaseHdc($hdc)
$gfx.Dispose()
$iconic = [Win32Capture]::IsIconic($hwnd)
$bmp.Dispose()
$base64 = ""
if ($ok) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $base64 = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
}
[pscustomobject]@{
  ok = $ok
  iconic = $iconic
  width = $width
  height = $height
  base64 = $base64
} | ConvertTo-Json -Compress
`.trim();

type ScreenshotDisplay = {
  id: string;
  name?: string;
  top: number;
  left: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  dpiScale?: number;
};

type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WindowInfo = {
  id: string;
  name: string;
  processName?: string;
  bounds: WindowBounds;
};

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

const runPowerShell = (script: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });

const runPowerShellWithBuffer = (script: string, maxBufferBytes: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, maxBuffer: maxBufferBytes },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });

const listWindows = async (): Promise<WindowInfo[]> => {
  const output = await runPowerShell(WINDOW_LIST_SCRIPT);
  if (!output) {
    return [];
  }
  let parsed: WindowInfo | WindowInfo[];
  try {
    parsed = JSON.parse(output) as WindowInfo | WindowInfo[];
  } catch (error: unknown) {
    await logError("capture.windows.parseFailed", { error: formatError(error) });
    return [];
  }
  const windows = Array.isArray(parsed) ? parsed : [parsed];
  return windows
    .filter((win) => Boolean(win && win.id && win.bounds))
    .map((win) => ({
      id: String(win.id),
      name: win.name ?? "Window",
      processName: win.processName,
      bounds: win.bounds
    }));
};

type PowerShellWindowCapture = {
  ok: boolean;
  iconic: boolean;
  width: number;
  height: number;
  base64: string;
};

const captureWindowViaPowerShell = async (windowId: string): Promise<PowerShellWindowCapture> => {
  if (!/^\d+$/.test(windowId)) {
    throw new Error("Invalid window id.");
  }
  const script = `$Id = [Int64]${windowId}\n${WINDOW_CAPTURE_SCRIPT}`;
  const output = await runPowerShellWithBuffer(script, 128 * 1024 * 1024);
  if (!output) {
    throw new Error("Window capture returned no output.");
  }
  try {
    return JSON.parse(output) as PowerShellWindowCapture;
  } catch (error: unknown) {
    await logError("capture.window.ps.parseFailed", { error: formatError(error), output });
    throw new Error("Failed to parse window capture output.");
  }
};

const normalizeOcrText = (text: string) => text.replace(/\s+/g, " ").trim();

const buildOcrPreview = (text: string) => {
  if (text.length <= OCR_PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, OCR_PREVIEW_LIMIT - 3)}...`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const temporarilyHideOverlay = async (): Promise<number | null> => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return null;
  }
  const previousOpacity = overlayWindow.getOpacity();
  if (previousOpacity <= 0) {
    return previousOpacity;
  }
  overlayWindow.setOpacity(0);
  await sleep(OVERLAY_HIDE_DELAY_MS);
  return previousOpacity;
};

const restoreOverlayOpacity = (opacity: number | null) => {
  if (opacity === null || !overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }
  overlayWindow.setOpacity(opacity);
};

const getScreenshotDimensions = (display: ScreenshotDisplay) => {
  const width =
    typeof display.width === "number"
      ? display.width
      : Math.abs((display.right ?? 0) - display.left);
  const height =
    typeof display.height === "number"
      ? display.height
      : Math.abs((display.bottom ?? 0) - display.top);
  return { width, height };
};

const listScreenshotDisplays = async (): Promise<ScreenshotDisplay[]> => {
  try {
    return await screenshotDesktop.listDisplays();
  } catch {
    return [];
  }
};

const scoreDisplayMatch = (electronDisplay: Electron.Display, candidate: ScreenshotDisplay) => {
  const { width, height } = getScreenshotDimensions(candidate);
  if (!width || !height) {
    return Number.POSITIVE_INFINITY;
  }
  const rawBounds = electronDisplay.bounds;
  const scale = electronDisplay.scaleFactor ?? 1;
  const scaledBounds = {
    x: Math.round(rawBounds.x * scale),
    y: Math.round(rawBounds.y * scale),
    width: Math.round(rawBounds.width * scale),
    height: Math.round(rawBounds.height * scale)
  };
  const score = (bounds: Electron.Rectangle) =>
    Math.abs(bounds.x - candidate.left) +
    Math.abs(bounds.y - candidate.top) +
    Math.abs(bounds.width - width) +
    Math.abs(bounds.height - height);
  return Math.min(score(rawBounds), score(scaledBounds));
};

const pickScreenshotDisplayForDisplay = (
  displays: ScreenshotDisplay[],
  electronDisplay: Electron.Display | null
): ScreenshotDisplay | null => {
  if (displays.length === 0) {
    return null;
  }
  if (!electronDisplay) {
    return displays[0];
  }
  let best = displays[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of displays) {
    const score = scoreDisplayMatch(electronDisplay, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
};

const formatDisplayLabel = (display: ScreenshotDisplay, index: number) => {
  const size = getScreenshotDimensions(display);
  const label = display.name ?? display.id;
  return `Display ${index + 1} (${size.width}x${size.height}) ${label}`.trim();
};

const listCaptureSources = async (): Promise<CaptureSource[]> => {
  const sources: CaptureSource[] = [];
  const displays = await listScreenshotDisplays();
  displays.forEach((display, index) => {
    sources.push({
      id: String(display.id),
      name: formatDisplayLabel(display, index),
      type: "display"
    });
  });
  try {
    const windows = await listWindows();
    windows.forEach((window) => {
      sources.push({
        id: window.id,
        name: window.name,
        type: "window",
        processName: window.processName
      });
    });
  } catch (error: unknown) {
    logError("capture.listSources.failed", { error: formatError(error) }).catch(() => undefined);
  }
  return sources;
};

const normalizeCropRect = (
  rect: { x: number; y: number; width: number; height: number },
  imageSize: { width: number; height: number }
) => {
  const x = Math.max(0, Math.min(rect.x, imageSize.width - 1));
  const y = Math.max(0, Math.min(rect.y, imageSize.height - 1));
  const width = Math.max(1, Math.min(rect.width, imageSize.width - x));
  const height = Math.max(1, Math.min(rect.height, imageSize.height - y));
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};

const computeWindowCropRect = (
  windowBounds: WindowBounds,
  displayBounds: Electron.Rectangle,
  imageSize: { width: number; height: number }
) => {
  if (displayBounds.width <= 0 || displayBounds.height <= 0) {
    return null;
  }
  const scaleX = imageSize.width / displayBounds.width;
  const scaleY = imageSize.height / displayBounds.height;
  const rectA = normalizeCropRect(
    {
      x: Math.round((windowBounds.x - displayBounds.x) * scaleX),
      y: Math.round((windowBounds.y - displayBounds.y) * scaleY),
      width: Math.round(windowBounds.width * scaleX),
      height: Math.round(windowBounds.height * scaleY)
    },
    imageSize
  );
  if (rectA) {
    return rectA;
  }
  const rectB = normalizeCropRect(
    {
      x: Math.round(windowBounds.x - displayBounds.x * scaleX),
      y: Math.round(windowBounds.y - displayBounds.y * scaleY),
      width: Math.round(windowBounds.width),
      height: Math.round(windowBounds.height)
    },
    imageSize
  );
  return rectB;
};

const normalizeRoi = (roi: CaptureRoi): CaptureRoi => {
  const x = Math.min(1, Math.max(0, roi.x));
  const y = Math.min(1, Math.max(0, roi.y));
  const width = Math.min(1, Math.max(0, roi.width));
  const height = Math.min(1, Math.max(0, roi.height));
  const x2 = Math.min(1, x + width);
  const y2 = Math.min(1, y + height);
  return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
};

const cropImageToRoi = (
  image: Buffer,
  roi: CaptureRoi
): { image: Buffer; rect: { x: number; y: number; width: number; height: number } } | null => {
  const native = nativeImage.createFromBuffer(image);
  const size = native.getSize();
  if (!size.width || !size.height) {
    return null;
  }
  const normalized = normalizeRoi(roi);
  const rawRect = {
    x: Math.round(normalized.x * size.width),
    y: Math.round(normalized.y * size.height),
    width: Math.round(normalized.width * size.width),
    height: Math.round(normalized.height * size.height)
  };
  const rect = normalizeCropRect(rawRect, size);
  if (!rect) {
    return null;
  }
  return { image: native.crop(rect).toPNG(), rect };
};

let loggedMissingPreprocess = false;
const preprocessForOcrSafe = (
  pngImage: Buffer,
  mode: "soft" | "binary"
): { image: Buffer; meta: unknown } => {
  const candidate = (
    ocrPreprocess as unknown as { preprocessForOcr?: (buf: Buffer, mode: "soft" | "binary") => unknown }
  ).preprocessForOcr;
  if (typeof candidate !== "function") {
    if (!loggedMissingPreprocess) {
      loggedMissingPreprocess = true;
      logError("ocr.preprocess.unavailable", {
        exports: Object.keys(ocrPreprocess ?? {}),
        typeof: typeof candidate
      }).catch(() => undefined);
    }
    return { image: pngImage, meta: { skipped: true, mode } };
  }
  return candidate(pngImage, mode) as { image: Buffer; meta: unknown };
};

const captureDisplayById = async (displayId: string) => {
  const previousOpacity = await temporarilyHideOverlay();
  let image: Buffer;
  try {
    image = await screenshotDesktop({ screen: displayId, format: "png" });
  } finally {
    restoreOverlayOpacity(previousOpacity);
  }
  const displays = await listScreenshotDisplays();
  const displayIndex = displays.findIndex((display) => String(display.id) === displayId);
  const displayInfo = displays.find((display) => String(display.id) === displayId);
  const sourceName = displayInfo
    ? formatDisplayLabel(displayInfo, Math.max(0, displayIndex))
    : `Display ${displayId}`;
  return {
    image,
    sourceId: displayId,
    sourceName,
    capturedAt: Date.now()
  };
};

const captureWindowById = async (windowId: string) => {
  const windows = await listWindows();
  const targetWindow = windows.find((window) => window.id === windowId);
  if (!targetWindow) {
    throw new Error("Window not found.");
  }
  const windowBounds = targetWindow.bounds;
  const previousOpacity = await temporarilyHideOverlay();
  let image: Buffer | null = null;
  let usedOccludedFallback = false;
  try {
    const result = await captureWindowViaPowerShell(windowId);
    if (result.ok) {
      if (!result.base64) {
        throw new Error("Selected window returned no image.");
      }
      image = Buffer.from(result.base64, "base64");
    } else {
      await logError("capture.window.printWindowFailed", {
        windowId,
        sourceName: targetWindow.name,
        iconic: result.iconic,
        width: result.width,
        height: result.height
      });
      if (result.iconic) {
        throw new Error("Selected window is minimized; capture is unavailable.");
      }

      try {
        const targetDisplay = screen.getDisplayMatching(windowBounds);
        const displays = await listScreenshotDisplays();
        const screenshotDisplay = pickScreenshotDisplayForDisplay(displays, targetDisplay);
        if (!screenshotDisplay) {
          throw new Error("No matching display.");
        }
        const displayImage = await screenshotDesktop({ screen: screenshotDisplay.id, format: "png" });
        const native = nativeImage.createFromBuffer(displayImage);
        const size = native.getSize();
        if (!size.width || !size.height) {
          throw new Error("Unable to read display image size.");
        }
        const cropRect = computeWindowCropRect(windowBounds, targetDisplay.bounds, size);
        if (!cropRect) {
          throw new Error("Window bounds are outside the captured display.");
        }
        image = native.crop(cropRect).toPNG();
        usedOccludedFallback = true;
        await logInfo("capture.window.fallbackDisplayCrop", {
          windowId,
          sourceName: targetWindow.name,
          displayId: screenshotDisplay.id,
          cropRect
        });
      } catch (error: unknown) {
        await logError("capture.window.fallbackDisplayCrop.failed", {
          windowId,
          sourceName: targetWindow.name,
          error: formatError(error)
        });
        throw new Error(
          "Selected window cannot be captured. Many games block window capture; try borderless fullscreen or pick a display source."
        );
      }
    }
  } finally {
    restoreOverlayOpacity(previousOpacity);
  }
  if (!image) {
    throw new Error("Window capture failed.");
  }
  return {
    image,
    sourceId: windowId,
    sourceName: usedOccludedFallback ? `${targetWindow.name} (occluded)` : targetWindow.name,
    capturedAt: Date.now()
  };
};

const captureFromTarget = async (target: CaptureTarget) => {
  if (target.type === "display") {
    return captureDisplayById(target.id);
  }
  if (target.type === "window") {
    return captureWindowById(target.id);
  }
  throw new Error("Unsupported capture target.");
};

const prepareOcrImage = (image: Buffer) => {
  const native = nativeImage.createFromBuffer(image);
  const size = native.getSize();
  const downScale = Math.min(1, OCR_MAX_WIDTH / size.width, OCR_MAX_HEIGHT / size.height);
  if (!Number.isFinite(downScale)) {
    return image;
  }
  let scale = downScale;
  if (downScale === 1) {
    const longSide = Math.max(size.width, size.height);
    if (longSide > 0 && longSide < OCR_UPSCALE_TARGET_LONG_SIDE) {
      scale = Math.min(OCR_UPSCALE_MAX, OCR_UPSCALE_TARGET_LONG_SIDE / longSide);
    }
  }
  if (scale === 1) {
    return image;
  }
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  return native.resize({ width, height, quality: "best" }).toPNG();
};

const scoreNumericPunctuation = (text: string) => {
  let score = 0;
  score += (text.match(/\d[.,]\d/g) ?? []).length * 2;
  score += (text.match(/\d{1,3}(?:,\d{3})+/g) ?? []).length * 3;
  score += (text.match(/\d{1,3}(?:\.\d{3})+/g) ?? []).length * 3;
  score += (text.match(/\(\s*\d[0-9.,]*%\s*\)/g) ?? []).length * 2;
  return score;
};

const shouldTryBinaryPreprocess = (text: string, confidence: number | null) => {
  const punctuationScore = scoreNumericPunctuation(text);
  const longDigitRuns = (text.match(/\d{5,}/g) ?? []).length;
  const percentFragments = (text.match(/%\b/g) ?? []).length;
  if (punctuationScore >= 2) {
    return false;
  }
  if (longDigitRuns >= 1 && percentFragments >= 1) {
    return true;
  }
  if (confidence !== null && confidence < 55 && longDigitRuns >= 1) {
    return true;
  }
  return false;
};

const pickBetterOcrText = (
  a: { text: string; confidence: number | null },
  b: { text: string; confidence: number | null }
) => {
  const aScore = scoreNumericPunctuation(a.text);
  const bScore = scoreNumericPunctuation(b.text);
  if (bScore >= aScore + 2) {
    return b;
  }
  if (aScore >= bScore + 2) {
    return a;
  }
  const aConf = a.confidence ?? -1;
  const bConf = b.confidence ?? -1;
  return bConf > aConf ? b : a;
};



const createOverlayWindow = async () => {
  const initialSettings = await loadSettings();
  cachedSettings = initialSettings;
  const bounds = resolveBounds(initialSettings);

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
      sandbox: false,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setOpacity(initialSettings.opacity);
  applyClickThrough(overlayWindow, initialSettings.clickThrough);

  if (initialSettings.displayId !== null) {
    const displays = screen.getAllDisplays();
    const target =
      displays.find((display) => display.id === initialSettings.displayId) ?? screen.getPrimaryDisplay();
    const currentBounds = overlayWindow.getBounds();
    const hasSavedBounds = Boolean(initialSettings.bounds);
    const alreadyOnTargetDisplay = rectsIntersect(currentBounds, target.bounds);
    if (!hasSavedBounds || !alreadyOnTargetDisplay) {
      positionOnDisplay(overlayWindow, initialSettings.displayId);
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

  overlayWindow.on("close", () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
      boundsTimer = null;
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

  ipcMain.handle("plan:save", async (_event, plan: OverlayPlan, meta?: PlanSaveMeta) => {
    await savePlan(plan, meta);
  });

  ipcMain.handle("plan:rollback", async (_event, snapshotId: string): Promise<OverlayPlan> => {
    return rollbackPlan(snapshotId);
  });

  ipcMain.handle("plan:undo", async (): Promise<OverlayPlan> => {
    return undoPlan();
  });

  ipcMain.handle("plan:redo", async (): Promise<OverlayPlan> => {
    return redoPlan();
  });

  ipcMain.handle(
    "planner:compose",
    async (_event, input: PlannerComposeInput) => {
      cachedSettings = cachedSettings ?? (await loadSettings());
      const result = await composeWithLlm(input, cachedSettings?.llm);
      await savePlan(result.plan, { reason: "compose", actor: "user" });
      await saveRules(result.rules);
      return result;
    }
  );

  ipcMain.handle("event-log:load", async () => loadEventLog());

  ipcMain.handle("event-log:save", async (_event, log: EventLog) => {
    await saveEventLog(log);
  });

  ipcMain.handle("memory:load", async (): Promise<MemoryStore> => {
    return loadMemory();
  });

  ipcMain.handle("memory:save", async (_event, store: MemoryStore) => {
    await saveMemory(store);
  });

  ipcMain.handle("memory:add", async (_event, entry: MemoryEntry): Promise<MemoryStore> => {
    return addMemoryEntry(entry);
  });

  ipcMain.handle("memory:delete", async (_event, entryId: string): Promise<MemoryStore> => {
    return deleteMemoryEntry(entryId);
  });

  ipcMain.handle("rules:load", async (): Promise<RulesStore> => {
    return loadRules();
  });

  ipcMain.handle("rules:save", async (_event, store: RulesStore) => {
    await saveRules(store);
  });

  ipcMain.handle("capture:list-sources", async (): Promise<CaptureSource[]> => {
    return listCaptureSources();
  });

  ipcMain.handle(
    "capture:snapshot",
    async (_event, target: CaptureTarget | null): Promise<CaptureSnapshotResult> => {
      if (!target) {
        throw new Error("Capture target missing.");
      }
      await logInfo("capture.snapshot.request", { target });
      const capture = await captureFromTarget(target);
      const capturePath = await saveCapture(capture.image, capture.sourceId, capture.capturedAt);
      const native = nativeImage.createFromBuffer(capture.image);
      const size = native.getSize();
      const maxWidth = 960;
      const maxHeight = 540;
      const previewScale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
      const preview =
        previewScale < 1
          ? native.resize({
              width: Math.max(1, Math.round(size.width * previewScale)),
              height: Math.max(1, Math.round(size.height * previewScale)),
              quality: "best"
            })
          : native;
      return {
        capturePath,
        sourceName: capture.sourceName,
        capturedAt: capture.capturedAt,
        width: size.width,
        height: size.height,
        dataUrl: preview.toDataURL()
      };
    }
  );

  ipcMain.handle("capture:request", async (_event, target: CaptureTarget | null): Promise<OcrResult> => {
    if (!target) {
      throw new Error("Capture target missing.");
    }
    await logInfo("capture.request", { target });
    try {
      const capture = await captureFromTarget(target);
      let imageForOcr = capture.image;
      const roi = cachedSettings?.captureRoi;
      if (
        roi &&
        cachedSettings?.captureSourceId === target.id &&
        cachedSettings?.captureSourceType === target.type
      ) {
        const cropped = cropImageToRoi(capture.image, roi);
        if (cropped) {
          imageForOcr = cropped.image;
          await logInfo("capture.roi.applied", {
            roi: normalizeRoi(roi),
            rect: cropped.rect
          });
        }
      }
      const capturePath = await saveCapture(capture.image, capture.sourceId, capture.capturedAt);
      await logInfo("capture.saved", {
        capturePath,
        sourceId: capture.sourceId,
        sourceName: capture.sourceName
      });
      try {
        const ocrImage = prepareOcrImage(imageForOcr);
        const preprocessedSoft = preprocessForOcrSafe(ocrImage, "soft");
        await logInfo("ocr.preprocess", (preprocessedSoft as { meta?: unknown }).meta);
        let ocr = await runOcr((preprocessedSoft as { image: Buffer }).image);
        if (shouldTryBinaryPreprocess(ocr.text ?? "", ocr.confidence)) {
          const preprocessedBinary = preprocessForOcrSafe(ocrImage, "binary");
          await logInfo("ocr.preprocess.binary", (preprocessedBinary as { meta?: unknown }).meta);
          const ocrBinary = await runOcr((preprocessedBinary as { image: Buffer }).image);
          const selected = pickBetterOcrText(ocr, ocrBinary);
          if (selected !== ocr) {
            await logInfo("ocr.variant.selected", {
              selected: "binary",
              scoreSoft: scoreNumericPunctuation(ocr.text ?? ""),
              scoreBinary: scoreNumericPunctuation(ocrBinary.text ?? ""),
              confidenceSoft: ocr.confidence,
              confidenceBinary: ocrBinary.confidence
            });
            ocr = ocrBinary;
          } else {
            await logInfo("ocr.variant.selected", {
              selected: "soft",
              scoreSoft: scoreNumericPunctuation(ocr.text ?? ""),
              scoreBinary: scoreNumericPunctuation(ocrBinary.text ?? ""),
              confidenceSoft: ocr.confidence,
              confidenceBinary: ocrBinary.confidence
            });
          }
        }
        const normalized = normalizeOcrText(ocr.text);
        const trimmed = normalized.slice(0, OCR_TEXT_LIMIT);
        const preview = trimmed ? buildOcrPreview(trimmed) : "No text detected.";
        await logInfo("ocr.success", {
          capturePath,
          confidence: ocr.confidence,
          preview,
          length: trimmed.length
        });
        return {
          text: ocr.text,
          confidence: ocr.confidence,
          capturePath,
          sourceName: capture.sourceName,
          capturedAt: capture.capturedAt
        };
      } catch (error: unknown) {
        await logError("ocr.failed", {
          capturePath,
          error: formatError(error)
        });
        return {
          text: "",
          confidence: null,
          capturePath,
          sourceName: capture.sourceName,
          capturedAt: capture.capturedAt,
          error: error instanceof Error ? error.message : "OCR failed"
        };
      }
    } catch (error: unknown) {
      await logError("capture.failed", {
        target,
        error: formatError(error)
      });
      throw error;
    }
  });

  // capture:process removed (capture handled in main via capture:request).
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
  shutdownOcrWorker().catch(() => undefined);
});
