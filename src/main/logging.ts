import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";

const PROFILE_NAME = "default";
const LOG_DIR = "logs";
const LOG_FILE = "overlay.log";

let logPathPromise: Promise<string> | null = null;

const getLogPath = async () => {
  if (!logPathPromise) {
    logPathPromise = (async () => {
      if (!app.isReady()) {
        await app.whenReady();
      }
      const dir = join(app.getPath("userData"), "profiles", PROFILE_NAME, LOG_DIR);
      await fs.mkdir(dir, { recursive: true });
      return join(dir, LOG_FILE);
    })();
  }
  return logPathPromise;
};

const formatPayload = (data?: unknown) => {
  if (data === undefined) {
    return "";
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

const appendLog = async (level: "INFO" | "ERROR", message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  const payload = formatPayload(data);
  const line = `[${timestamp}] [${level}] ${message}${payload ? ` ${payload}` : ""}\n`;
  try {
    const path = await getLogPath();
    await fs.appendFile(path, line, "utf-8");
  } catch {
    // Avoid failing the app due to logging issues.
  }
};

export const logInfo = async (message: string, data?: unknown) => {
  await appendLog("INFO", message, data);
};

export const logError = async (message: string, data?: unknown) => {
  await appendLog("ERROR", message, data);
};
