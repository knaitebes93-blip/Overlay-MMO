import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import {
  EventLog,
  MemoryStore,
  OverlayPlan,
  OverlaySettings,
  PlanLoadResult,
  RulesStore
} from "../shared/ipc";
import { eventLogSchema } from "../shared/eventLogSchema";
import { memoryStoreSchema } from "../shared/memorySchema";
import { overlayPlanSchema } from "../shared/planSchema";
import { rulesStoreSchema } from "../shared/rulesSchema";

const PROFILE_NAME = "default";
const SETTINGS_FILE = "settings.json";
const PLAN_FILE = "plan.json";
const PLAN_LAST_GOOD_FILE = "plan.last-good.json";
const PLAN_HISTORY_FILE = "plan.history.json";
const EVENT_LOG_FILE = "event-log.json";
const MEMORY_FILE = "memory.json";
const RULES_FILE = "rules.json";
const CAPTURE_DIR = "captures";
const CAPTURE_MAX_FILES = 10;
const PLAN_HISTORY_LIMIT = 20;

const defaultSettings: OverlaySettings = {
  bounds: null,
  displayId: null,
  opacity: 0.92,
  clickThrough: false,
  captureEnabled: false,
  captureSourceType: null,
  captureSourceId: null,
  captureRoi: null,
  llm: {
    enabled: false,
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2:1b",
    apiKey: ""
  }
};

const defaultEventLog: EventLog = {
  version: "1.0",
  entries: []
};

const defaultMemory: MemoryStore = {
  version: "1.0",
  entries: []
};

const defaultRules: RulesStore = {
  version: "1.0",
  rules: []
};

type PlanHistory = {
  version: "1.0";
  undo: OverlayPlan[];
  redo: OverlayPlan[];
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

const sanitizeSegment = (value: string): string =>
  value.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "");

export const loadSettings = async (): Promise<OverlaySettings> => {
  const dir = await ensureProfileDir();
  const stored = await readJson(join(dir, SETTINGS_FILE), defaultSettings);
  const merged = { ...defaultSettings, ...stored, captureEnabled: false };
  if ((stored as Partial<OverlaySettings>).captureEnabled) {
    try {
      await writeJson(join(dir, SETTINGS_FILE), merged);
    } catch {
      // ignore persistence failures; capture stays disabled in memory
    }
  }
  return merged;
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

  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);
  const historyPath = join(dir, PLAN_HISTORY_FILE);

  const readValidatedPlan = async (file: string): Promise<OverlayPlan | null> => {
    const candidate = await readJsonUnknown(file);
    if (candidate.data === null) {
      return null;
    }
    const parsed = overlayPlanSchema.safeParse(candidate.data);
    return parsed.success ? (parsed.data as OverlayPlan) : null;
  };

  const current = (await readValidatedPlan(planPath)) ?? (await readValidatedPlan(backupPath));
  if (current && JSON.stringify(current) !== JSON.stringify(payload)) {
    try {
      const historyCandidate = await readJsonUnknown(historyPath);
      const historyData =
        historyCandidate.data && typeof historyCandidate.data === "object"
          ? (historyCandidate.data as Partial<PlanHistory>)
          : null;
      const history: PlanHistory = {
        version: "1.0",
        undo: Array.isArray(historyData?.undo) ? (historyData?.undo as OverlayPlan[]) : [],
        redo: Array.isArray(historyData?.redo) ? (historyData?.redo as OverlayPlan[]) : []
      };
      history.undo = [...history.undo, current].slice(-PLAN_HISTORY_LIMIT);
      history.redo = [];
      await writeJson(historyPath, history);
    } catch {
      // Ignore history failures; saving the plan should still work.
    }
  }

  await writeJson(backupPath, payload);
  await writeJson(planPath, payload);
};

const readPlanHistory = async (dir: string): Promise<PlanHistory> => {
  const historyPath = join(dir, PLAN_HISTORY_FILE);
  const candidate = await readJsonUnknown(historyPath);
  const historyData =
    candidate.data && typeof candidate.data === "object" ? (candidate.data as Partial<PlanHistory>) : null;
  return {
    version: "1.0",
    undo: Array.isArray(historyData?.undo) ? (historyData?.undo as OverlayPlan[]) : [],
    redo: Array.isArray(historyData?.redo) ? (historyData?.redo as OverlayPlan[]) : []
  };
};

export const undoPlan = async (): Promise<OverlayPlan> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const candidate = await readJsonUnknown(planPath);
  const currentValidation = overlayPlanSchema.safeParse(candidate.data);
  if (!currentValidation.success) {
    throw new Error("No valid plan to undo.");
  }
  const current = currentValidation.data as OverlayPlan;

  const history = await readPlanHistory(dir);
  if (history.undo.length === 0) {
    throw new Error("Nothing to undo.");
  }
  const nextRaw = history.undo[history.undo.length - 1];
  const nextValidation = overlayPlanSchema.safeParse(nextRaw);
  if (!nextValidation.success) {
    throw new Error("Undo history contains an invalid plan.");
  }

  history.undo = history.undo.slice(0, -1);
  history.redo = [...history.redo, current].slice(-PLAN_HISTORY_LIMIT);

  await writeJson(join(dir, PLAN_HISTORY_FILE), history);
  await writeJson(backupPath, nextValidation.data as OverlayPlan);
  await writeJson(planPath, nextValidation.data as OverlayPlan);
  return nextValidation.data as OverlayPlan;
};

export const redoPlan = async (): Promise<OverlayPlan> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const candidate = await readJsonUnknown(planPath);
  const currentValidation = overlayPlanSchema.safeParse(candidate.data);
  if (!currentValidation.success) {
    throw new Error("No valid plan to redo.");
  }
  const current = currentValidation.data as OverlayPlan;

  const history = await readPlanHistory(dir);
  if (history.redo.length === 0) {
    throw new Error("Nothing to redo.");
  }
  const nextRaw = history.redo[history.redo.length - 1];
  const nextValidation = overlayPlanSchema.safeParse(nextRaw);
  if (!nextValidation.success) {
    throw new Error("Redo history contains an invalid plan.");
  }

  history.redo = history.redo.slice(0, -1);
  history.undo = [...history.undo, current].slice(-PLAN_HISTORY_LIMIT);

  await writeJson(join(dir, PLAN_HISTORY_FILE), history);
  await writeJson(backupPath, nextValidation.data as OverlayPlan);
  await writeJson(planPath, nextValidation.data as OverlayPlan);
  return nextValidation.data as OverlayPlan;
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

export const loadMemory = async (): Promise<MemoryStore> => {
  const dir = await ensureProfileDir();
  const path = join(dir, MEMORY_FILE);
  const candidate = await readJsonUnknown(path);
  if (candidate.data !== null) {
    const validation = memoryStoreSchema.safeParse(candidate.data);
    if (validation.success) {
      return validation.data as MemoryStore;
    }
  }
  return defaultMemory;
};

export const saveMemory = async (store: MemoryStore): Promise<void> => {
  const validation = memoryStoreSchema.safeParse(store);
  if (!validation.success) {
    throw new Error(
      `Refusing to save invalid memory store: ${validation.error.errors
        .map((err) => err.message)
        .join("; ")}`
    );
  }
  const dir = await ensureProfileDir();
  await writeJson(join(dir, MEMORY_FILE), validation.data as MemoryStore);
};

export const loadRules = async (): Promise<RulesStore> => {
  const dir = await ensureProfileDir();
  const path = join(dir, RULES_FILE);
  const candidate = await readJsonUnknown(path);
  if (candidate.data !== null) {
    const validation = rulesStoreSchema.safeParse(candidate.data);
    if (validation.success) {
      return validation.data as RulesStore;
    }
  }
  return defaultRules;
};

export const saveRules = async (store: RulesStore): Promise<void> => {
  const validation = rulesStoreSchema.safeParse(store);
  if (!validation.success) {
    throw new Error(
      `Refusing to save invalid rules store: ${validation.error.errors
        .map((err) => err.message)
        .join("; ")}`
    );
  }
  const dir = await ensureProfileDir();
  await writeJson(join(dir, RULES_FILE), validation.data as RulesStore);
};

export const saveCapture = async (
  image: Buffer,
  sourceId: string,
  capturedAt: number
): Promise<string> => {
  const dir = await ensureProfileDir();
  const captureDir = join(dir, CAPTURE_DIR);
  await fs.mkdir(captureDir, { recursive: true });
  const safeSource = sanitizeSegment(sourceId) || "screen";
  const timestamp = new Date(capturedAt).toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-${safeSource}.png`;
  const filePath = join(captureDir, fileName);
  await fs.writeFile(filePath, image);
  try {
    const entries = await fs.readdir(captureDir);
    const captures = entries
      .filter((entry) => entry.toLowerCase().endsWith(".png"))
      .sort();
    if (captures.length > CAPTURE_MAX_FILES) {
      const excess = captures.slice(0, captures.length - CAPTURE_MAX_FILES);
      await Promise.all(
        excess.map((entry) => fs.unlink(join(captureDir, entry)).catch(() => undefined))
      );
    }
  } catch {
    // Ignore retention failures to keep capture flow safe.
  }
  return filePath;
};
