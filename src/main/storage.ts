import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import { OverlayPlan, OverlaySettings } from "../shared/ipc";

const PROFILE_NAME = "default";
const SETTINGS_FILE = "settings.json";
const PLAN_FILE = "plan.json";

const defaultSettings: OverlaySettings = {
  bounds: null,
  displayId: null,
  opacity: 0.92,
  clickThrough: false
};

const ensureProfileDir = async (): Promise<string> => {
  const dir = join(app.getPath("userData"), "profiles", PROFILE_NAME);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = async <T>(file: string, data: T): Promise<void> => {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
};

export const loadSettings = async (): Promise<OverlaySettings> => {
  const dir = await ensureProfileDir();
  return readJson(join(dir, SETTINGS_FILE), defaultSettings);
};

export const saveSettings = async (settings: OverlaySettings): Promise<void> => {
  const dir = await ensureProfileDir();
  await writeJson(join(dir, SETTINGS_FILE), settings);
};

export const loadPlan = async (): Promise<OverlayPlan | null> => {
  const dir = await ensureProfileDir();
  return readJson(join(dir, PLAN_FILE), null);
};

export const savePlan = async (plan: OverlayPlan): Promise<void> => {
  const dir = await ensureProfileDir();
  await writeJson(join(dir, PLAN_FILE), plan);
};
