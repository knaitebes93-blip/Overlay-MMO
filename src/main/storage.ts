import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import { EventLog, OverlayPlan, OverlaySettings, PlanLoadResult } from "../shared/ipc";
import { eventLogSchema } from "../shared/eventLogSchema";
import { overlayPlanSchema } from "../shared/planSchema";

const PROFILE_NAME = "default";
const SETTINGS_FILE = "settings.json";
const PLAN_FILE = "plan.json";
const PLAN_LAST_GOOD_FILE = "plan.last-good.json";
const EVENT_LOG_FILE = "event-log.json";

const defaultSettings: OverlaySettings = {
  bounds: null,
  displayId: null,
  opacity: 0.92,
  clickThrough: false
};

const defaultEventLog: EventLog = {
  version: "1.0",
  entries: []
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

const readJsonUnknown = async (
  file: string
): Promise<{ data: unknown | null; missing: boolean; error?: string }> => {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return { data: JSON.parse(raw) as unknown, missing: false };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { data: null, missing: true };
    }
    return {
      data: null,
      missing: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
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

export const loadPlan = async (): Promise<PlanLoadResult> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const candidate = await readJsonUnknown(planPath);
  if (candidate.data !== null) {
    const validation = overlayPlanSchema.safeParse(candidate.data);
    if (validation.success) {
      return { plan: validation.data as OverlayPlan };
    }

    const backup = await readJsonUnknown(backupPath);
    if (backup.data !== null) {
      const backupValidation = overlayPlanSchema.safeParse(backup.data);
      if (backupValidation.success) {
        return {
          plan: backupValidation.data as OverlayPlan,
          warning: `Plan inválido en disco; usando último plan válido. ${validation.error.errors
            .map((err) => err.message)
            .join("; ")}`
        };
      }
    }

    return {
      plan: null,
      warning: `Plan inválido en disco y no se encontró respaldo válido. ${validation.error.errors
        .map((err) => err.message)
        .join("; ")}`
    };
  }

  const backup = await readJsonUnknown(backupPath);
  if (backup.data !== null) {
    const backupValidation = overlayPlanSchema.safeParse(backup.data);
    if (backupValidation.success) {
      return { plan: backupValidation.data as OverlayPlan };
    }
  }

  if (candidate.missing) {
    return { plan: null };
  }

  return {
    plan: null,
    warning: candidate.error
      ? `No se pudo leer plan.json. ${candidate.error}`
      : "No se pudo leer plan.json."
  };
};

export const savePlan = async (plan: OverlayPlan): Promise<void> => {
  const validation = overlayPlanSchema.safeParse(plan);
  if (!validation.success) {
    throw new Error(
      `Refusing to save invalid plan: ${validation.error.errors
        .map((err) => err.message)
        .join("; ")}`
    );
  }
  const dir = await ensureProfileDir();
  const payload = validation.data as OverlayPlan;
  await writeJson(join(dir, PLAN_LAST_GOOD_FILE), payload);
  await writeJson(join(dir, PLAN_FILE), payload);
};

export const loadEventLog = async (): Promise<EventLog> => {
  const dir = await ensureProfileDir();
  const logPath = join(dir, EVENT_LOG_FILE);
  const candidate = await readJsonUnknown(logPath);
  if (candidate.data !== null) {
    const validation = eventLogSchema.safeParse(candidate.data);
    if (validation.success) {
      return validation.data as EventLog;
    }
  }
  return defaultEventLog;
};

export const saveEventLog = async (log: EventLog): Promise<void> => {
  const validation = eventLogSchema.safeParse(log);
  if (!validation.success) {
    throw new Error(
      `Refusing to save invalid event log: ${validation.error.errors
        .map((err) => err.message)
        .join("; ")}`
    );
  }
  const dir = await ensureProfileDir();
  await writeJson(join(dir, EVENT_LOG_FILE), validation.data as EventLog);
};
