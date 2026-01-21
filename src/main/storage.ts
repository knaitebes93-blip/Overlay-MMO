import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  EventLog,
  MemoryEntry,
  MemoryStore,
  OverlaySettings,
  PlanSaveMeta,
  PlanLoadResult,
  RulesStore,
  OverlayPlan
} from "../shared/ipc";
import { eventLogSchema } from "../shared/eventLogSchema";
import { memoryEntrySchema, memoryStoreSchema } from "../shared/memorySchema";
import { rulesStoreSchema } from "../shared/rulesSchema";
import { migrateLegacyPlan, validateWidgetSpec, WidgetSpec } from "../widgetSpec";
import { Profile, ProfileStore as ProfileStoreType } from "../types/profile";
import { overlayPlanToWidgetSpec } from "../state/planStore";

const PROFILE_NAME = "default";
const SETTINGS_FILE = "settings.json";
const PROFILES_FILE = "profiles.json";
const PLAN_FILE = "plan.json";
const PLAN_LAST_GOOD_FILE = "plan.last-good.json";
const PLAN_HISTORY_FILE = "plan.history.json";
const EVENT_LOG_FILE = "event-log.json";
const MEMORY_FILE = "memory.json";
const RULES_FILE = "rules.json";
const CAPTURE_DIR = "captures";
const CAPTURE_MAX_FILES = 10;
const MEMORY_ENTRY_LIMIT = 500;
const PLAN_SNAPSHOT_LIMIT = 50;
const PLAN_HISTORY_LIMIT = PLAN_SNAPSHOT_LIMIT;
const MEMORY_PAYLOAD_LIMIT_BYTES = 256 * 1024;

const defaultSettings: OverlaySettings = {
  bounds: null,
  displayId: null,
  opacity: 0.92,
  clickThrough: false,
  captureEnabled: false,
  captureSourceType: null,
  captureSourceId: null,
  captureRoi: null,
  uiMode: "gameplay",
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
  rules: [
    {
      id: "rule-exp-current",
      enabled: true,
      mode: "regex",
      pattern: "EXP\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)",
      action: {
        type: "setTextWidget",
        widgetId: "text-exp-current",
        template: "EXP ${g1}"
      }
    },
    {
      id: "rule-exp-rate",
      enabled: true,
      mode: "regex",
      pattern: "EXP\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)",
      action: {
        type: "trackRate",
        widgetId: "text-exp-rate",
        template: "EXP/h ${rate}",
        valueSource: "g1",
        precision: 2,
        minSeconds: 60
      }
    }
  ]
};

const legacyMemoryEntrySchema = z.object({
  id: z.string(),
  createdAt: z.number().nonnegative(),
  text: z.string().min(1),
  tags: z.array(z.string()).optional()
});

const legacyMemoryStoreSchema = z.object({
  version: z.literal("1.0"),
  entries: z.array(legacyMemoryEntrySchema)
});

type PlanHistory = {
  version: "1.0";
  currentSnapshotId: string | null;
  undo: string[];
  redo: string[];
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

const buildSnapshotId = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `snap-${Date.now()}-${suffix}`;
};

const getPayloadSize = (payload: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? {}), "utf-8");
  } catch {
    return MEMORY_PAYLOAD_LIMIT_BYTES + 1;
  }
};

const trimMemoryEntries = (entries: MemoryEntry[]): MemoryEntry[] => {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const seen = new Set<string>();
  const unique = sorted.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
  const sized = unique.filter((entry) => getPayloadSize(entry.payload) <= MEMORY_PAYLOAD_LIMIT_BYTES);
  const snapshots = sized
    .filter((entry) => entry.type === "plan_snapshot")
    .slice(0, PLAN_SNAPSHOT_LIMIT);
  const snapshotIds = new Set(snapshots.map((entry) => entry.id));
  const remainingSlots = Math.max(0, MEMORY_ENTRY_LIMIT - snapshots.length);
  const others = sized
    .filter((entry) => entry.type !== "plan_snapshot" && !snapshotIds.has(entry.id))
    .slice(0, remainingSlots);
  return [...snapshots, ...others];
};

const sanitizeMemoryStore = (store: MemoryStore): MemoryStore => ({
  version: "1.0",
  entries: trimMemoryEntries(store.entries)
});

const isPlanSnapshotEntry = (
  entry: MemoryEntry
): entry is MemoryEntry & { type: "plan_snapshot" } => entry.type === "plan_snapshot";

const getSnapshotIdSet = (entries: MemoryEntry[]) =>
  new Set(
    entries.filter(isPlanSnapshotEntry).map((entry) => entry.payload.snapshotId)
  );

const getLatestSnapshotId = (entries: MemoryEntry[]): string | null => {
  const snapshots = entries.filter(isPlanSnapshotEntry);
  if (snapshots.length === 0) {
    return null;
  }
  const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
  return sorted[0].payload.snapshotId;
};

const prunePlanHistory = (
  history: PlanHistory,
  entries: MemoryEntry[],
  fallbackSnapshotId?: string | null
): PlanHistory => {
  const snapshotIds = getSnapshotIdSet(entries);
  const currentSnapshotId =
    history.currentSnapshotId && snapshotIds.has(history.currentSnapshotId)
      ? history.currentSnapshotId
      : fallbackSnapshotId && snapshotIds.has(fallbackSnapshotId)
        ? fallbackSnapshotId
        : getLatestSnapshotId(entries);
  const filteredUndo = history.undo.filter((id) => snapshotIds.has(id));
  const filteredRedo = history.redo.filter((id) => snapshotIds.has(id));
  return {
    version: "1.0",
    currentSnapshotId,
    undo: filteredUndo.filter((id) => id !== currentSnapshotId),
    redo: filteredRedo.filter((id) => id !== currentSnapshotId)
  };
};

const findSnapshotEntry = (entries: MemoryEntry[], snapshotId: string) =>
  entries.find(
    (entry): entry is MemoryEntry & { type: "plan_snapshot" } =>
      entry.type === "plan_snapshot" && entry.payload.snapshotId === snapshotId
  );

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

const buildFallbackWidgetSpec = (message: string): WidgetSpec => ({
  version: "1.0",
  profileId: PROFILE_NAME,
  widgets: [
    {
      id: "notes_fallback",
      type: "notes",
      title: "Plan Reset",
      data: {
        requiredFields: [
          {
            key: "text",
            label: "Text",
            type: "string",
            question: "Notes text?"
          }
        ],
        values: { text: message },
        outputs: [{ label: "Text", valueKey: "text" }],
        layout: { w: 320, h: 160 }
      }
    }
  ]
});

const resolveWidgetSpecPlan = (
  payload: unknown
): { ok: true; plan: WidgetSpec; warnings: string[] } | { ok: false; error: string } => {
  const validated = validateWidgetSpec(payload);
  if (validated.ok) {
    return { ok: true, plan: validated.value, warnings: [] };
  }
  const migration = migrateLegacyPlan(payload, PROFILE_NAME);
  if (migration.ok) {
    const migratedValidation = validateWidgetSpec(migration.value);
    if (migratedValidation.ok) {
      return { ok: true, plan: migratedValidation.value, warnings: migration.warnings };
    }
    return { ok: false, error: migratedValidation.error };
  }
  return {
    ok: false,
    error: `${validated.error} | ${migration.error}`.trim()
  };
};

export const loadPlan = async (): Promise<PlanLoadResult> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const candidate = await readJsonUnknown(planPath);
  if (candidate.data !== null) {
    const validation = resolveWidgetSpecPlan(candidate.data);
    if (validation.ok) {
      if (validation.warnings.length > 0) {
        return {
          plan: validation.plan,
          warning: `Plan migrado desde formato legado. ${validation.warnings.join(" ")}`
        };
      }
      return { plan: validation.plan };
    }

    const backup = await readJsonUnknown(backupPath);
    if (backup.data !== null) {
      const backupValidation = resolveWidgetSpecPlan(backup.data);
      if (backupValidation.ok) {
        return {
          plan: backupValidation.plan,
          warning: `Plan invalido en disco; usando ultimo plan valido. ${validation.error}`
        };
      }
    }

    const fallback = buildFallbackWidgetSpec("Plan invalido. Se restauro un plan minimo.");
    await writeJson(backupPath, fallback);
    await writeJson(planPath, fallback);
    return {
      plan: fallback,
      warning: `Plan invalido en disco y no se encontro respaldo valido. ${validation.error}`
    };
  }

  const backup = await readJsonUnknown(backupPath);
  if (backup.data !== null) {
    const backupValidation = resolveWidgetSpecPlan(backup.data);
    if (backupValidation.ok) {
      return { plan: backupValidation.plan };
    }
  }

  const fallback = buildFallbackWidgetSpec("No se encontro plan. Se creo un plan minimo.");
  await writeJson(backupPath, fallback);
  await writeJson(planPath, fallback);

  if (candidate.missing) {
    return { plan: fallback };
  }

  return {
    plan: fallback,
    warning: candidate.error
      ? `No se pudo leer plan.json. ${candidate.error}`
      : "No se pudo leer plan.json."
  };
};

export const savePlan = async (
  plan: WidgetSpec | unknown,
  meta?: PlanSaveMeta
): Promise<WidgetSpec> => {
  const validation = resolveWidgetSpecPlan(plan);
  if (!validation.ok) {
    throw new Error(`Refusing to save invalid plan: ${validation.error}`);
  }
  const dir = await ensureProfileDir();
  const payload = validation.plan;

  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);
  const historyPath = join(dir, PLAN_HISTORY_FILE);

  const readValidatedPlan = async (file: string): Promise<WidgetSpec | null> => {
    const candidate = await readJsonUnknown(file);
    if (candidate.data === null) {
      return null;
    }
    const parsed = resolveWidgetSpecPlan(candidate.data);
    return parsed.ok ? parsed.plan : null;
  };

  const current = (await readValidatedPlan(planPath)) ?? (await readValidatedPlan(backupPath));
  const hasChanged = !current || JSON.stringify(current) !== JSON.stringify(payload);

  if (hasChanged) {
    try {
      const memory = await loadMemory();
      const history = await readPlanHistory(dir);
      const baseSnapshotId = history.currentSnapshotId ?? undefined;
      const snapshotId = buildSnapshotId();
      const snapshotEntry: MemoryEntry = {
        id: snapshotId,
        profileId: PROFILE_NAME,
        type: "plan_snapshot",
        createdAt: Date.now(),
        source: "system",
        payload: {
          snapshotId,
          planJson: payload,
          reason: meta?.reason?.trim() || "plan:update",
          actor: meta?.actor ?? "user",
          baseSnapshotId
        }
      };

      if (getPayloadSize(snapshotEntry.payload) <= MEMORY_PAYLOAD_LIMIT_BYTES) {
        const nextMemory = sanitizeMemoryStore({
          ...memory,
          entries: [snapshotEntry, ...memory.entries]
        });
        await writeJson(join(dir, MEMORY_FILE), nextMemory);
        const nextHistory: PlanHistory = {
          version: "1.0",
          currentSnapshotId: snapshotId,
          undo: baseSnapshotId
            ? [...history.undo, baseSnapshotId].slice(-PLAN_HISTORY_LIMIT)
            : history.undo,
          redo: []
        };
        const pruned = prunePlanHistory(nextHistory, nextMemory.entries, snapshotId);
        await writeJson(historyPath, pruned);
      }
    } catch {
      // Ignore history failures; saving the plan should still work.
    }
  }

  await writeJson(backupPath, payload);
  await writeJson(planPath, payload);
  return payload;
};

const readPlanHistory = async (dir: string): Promise<PlanHistory> => {
  const historyPath = join(dir, PLAN_HISTORY_FILE);
  const candidate = await readJsonUnknown(historyPath);
  const historyData =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Partial<PlanHistory>)
      : null;
  const toStringArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    version: "1.0",
    currentSnapshotId:
      typeof historyData?.currentSnapshotId === "string" ? historyData.currentSnapshotId : null,
    undo: toStringArray(historyData?.undo),
    redo: toStringArray(historyData?.redo)
  };
};

export const undoPlan = async (): Promise<WidgetSpec> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const history = await readPlanHistory(dir);
  if (!history.currentSnapshotId) {
    throw new Error("No valid plan to undo.");
  }
  if (history.undo.length === 0) {
    throw new Error("Nothing to undo.");
  }
  const nextSnapshotId = history.undo[history.undo.length - 1];
  const memory = await loadMemory();
  const nextEntry = findSnapshotEntry(memory.entries, nextSnapshotId);
  if (!nextEntry) {
    throw new Error("Undo snapshot not found.");
  }
  const nextValidation = resolveWidgetSpecPlan(nextEntry.payload.planJson);
  if (!nextValidation.ok) {
    throw new Error("Undo snapshot contains an invalid plan.");
  }

  const nextHistory = prunePlanHistory(
    {
      version: "1.0",
      currentSnapshotId: nextSnapshotId,
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, history.currentSnapshotId].slice(-PLAN_HISTORY_LIMIT)
    },
    memory.entries,
    nextSnapshotId
  );

  await writeJson(join(dir, PLAN_HISTORY_FILE), nextHistory);
  await writeJson(backupPath, nextValidation.plan);
  await writeJson(planPath, nextValidation.plan);
  return nextValidation.plan;
};

export const redoPlan = async (): Promise<WidgetSpec> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const history = await readPlanHistory(dir);
  if (!history.currentSnapshotId) {
    throw new Error("No valid plan to redo.");
  }
  if (history.redo.length === 0) {
    throw new Error("Nothing to redo.");
  }
  const nextSnapshotId = history.redo[history.redo.length - 1];
  const memory = await loadMemory();
  const nextEntry = findSnapshotEntry(memory.entries, nextSnapshotId);
  if (!nextEntry) {
    throw new Error("Redo snapshot not found.");
  }
  const nextValidation = resolveWidgetSpecPlan(nextEntry.payload.planJson);
  if (!nextValidation.ok) {
    throw new Error("Redo snapshot contains an invalid plan.");
  }

  const nextHistory = prunePlanHistory(
    {
      version: "1.0",
      currentSnapshotId: nextSnapshotId,
      undo: [...history.undo, history.currentSnapshotId].slice(-PLAN_HISTORY_LIMIT),
      redo: history.redo.slice(0, -1)
    },
    memory.entries,
    nextSnapshotId
  );

  await writeJson(join(dir, PLAN_HISTORY_FILE), nextHistory);
  await writeJson(backupPath, nextValidation.plan);
  await writeJson(planPath, nextValidation.plan);
  return nextValidation.plan;
};

export const rollbackPlan = async (snapshotId: string): Promise<WidgetSpec> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const memory = await loadMemory();
  const entry = findSnapshotEntry(memory.entries, snapshotId);
  if (!entry) {
    throw new Error("Snapshot not found.");
  }
  const validation = resolveWidgetSpecPlan(entry.payload.planJson);
  if (!validation.ok) {
    throw new Error("Snapshot contains an invalid plan.");
  }

  const snapshotMap = new Map<string, MemoryEntry & { type: "plan_snapshot" }>();
  memory.entries.forEach((memEntry) => {
    if (memEntry.type === "plan_snapshot") {
      snapshotMap.set(memEntry.payload.snapshotId, memEntry);
    }
  });

  const buildUndoChain = (startId: string): string[] => {
    const chain: string[] = [];
    let cursor: string | undefined = startId;
    while (cursor) {
      const current = snapshotMap.get(cursor);
      const base = current?.payload.baseSnapshotId;
      if (!base) {
        break;
      }
      chain.push(base);
      cursor = base;
    }
    return chain.reverse();
  };

  const nextHistory = prunePlanHistory(
    {
      version: "1.0",
      currentSnapshotId: snapshotId,
      undo: buildUndoChain(snapshotId).slice(-PLAN_HISTORY_LIMIT),
      redo: []
    },
    memory.entries,
    snapshotId
  );

  await writeJson(join(dir, PLAN_HISTORY_FILE), nextHistory);
  await writeJson(backupPath, validation.plan);
  await writeJson(planPath, validation.plan);
  return validation.plan;
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
      return sanitizeMemoryStore(validation.data as MemoryStore);
    }
    const legacyValidation = legacyMemoryStoreSchema.safeParse(candidate.data);
    if (legacyValidation.success) {
      const migrated: MemoryStore = {
        version: "1.0",
        entries: legacyValidation.data.entries.map((entry) => ({
          id: entry.id,
          profileId: PROFILE_NAME,
          type: "note",
          createdAt: entry.createdAt,
          source: "user",
          payload: { text: entry.text },
          tags: entry.tags
        }))
      };
      return sanitizeMemoryStore(migrated);
    }
  }
  return defaultMemory;
};

export const saveMemory = async (store: MemoryStore): Promise<void> => {
  const sanitized = sanitizeMemoryStore(store);
  const validation = memoryStoreSchema.safeParse(sanitized);
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

export const addMemoryEntry = async (entry: MemoryEntry): Promise<MemoryStore> => {
  const entryValidation = memoryEntrySchema.safeParse(entry);
  if (!entryValidation.success) {
    throw new Error(
      `Refusing to add invalid memory entry: ${entryValidation.error.errors
        .map((err) => err.message)
        .join("; ")}`
    );
  }
  if (getPayloadSize(entry.payload) > MEMORY_PAYLOAD_LIMIT_BYTES) {
    throw new Error("Memory entry payload exceeds 256 KB.");
  }
  const dir = await ensureProfileDir();
  const current = await loadMemory();
  const next = sanitizeMemoryStore({
    ...current,
    entries: [entryValidation.data as MemoryEntry, ...current.entries]
  });
  await writeJson(join(dir, MEMORY_FILE), next);
  return next;
};

export const deleteMemoryEntry = async (entryId: string): Promise<MemoryStore> => {
  const dir = await ensureProfileDir();
  const current = await loadMemory();
  const next = sanitizeMemoryStore({
    ...current,
    entries: current.entries.filter((entry) => entry.id !== entryId)
  });
  await writeJson(join(dir, MEMORY_FILE), next);
  return next;
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

/**
 * Profile persistence - manages multi-profile scoped storage
 */

export const loadProfiles = async (): Promise<ProfileStoreType> => {
  const dir = await ensureProfileDir();
  const filePath = join(dir, PROFILES_FILE);

  const defaults: ProfileStoreType = {
    version: "1.0",
    profiles: [
      {
        id: "profile_default",
        name: "Default",
        capabilities: ["manual_inputs", "ocr_snapshot", "clipboard_parse", "log_import"],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ],
    activeProfileId: "profile_default"
  };

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as ProfileStoreType;
    if (
      data &&
      typeof data === "object" &&
      "version" in data &&
      data.version === "1.0" &&
      "profiles" in data &&
      Array.isArray(data.profiles) &&
      "activeProfileId" in data
    ) {
      return data;
    }
  } catch {
    // Fall through to defaults
  }

  return defaults;
};

export const saveProfiles = async (store: ProfileStoreType): Promise<void> => {
  const dir = await ensureProfileDir();
  const filePath = join(dir, PROFILES_FILE);
  await writeJson(filePath, store);
};

/**
 * Get profile-scoped directory
 */
const getProfileDir = async (profileId: string): Promise<string> => {
  const parentDir = join(app.getPath("userData"), "profiles");
  const sanitized = sanitizeSegment(profileId) || "default";
  const dir = join(parentDir, sanitized);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

/**
 * Load plan for a specific profile
 */
export const loadPlanForProfile = async (profileId: string): Promise<PlanLoadResult> => {
  const dir = await getProfileDir(profileId);
  const planFile = join(dir, PLAN_FILE);
  const planLastGoodFile = join(dir, PLAN_LAST_GOOD_FILE);
  const planHistoryFile = join(dir, PLAN_HISTORY_FILE);

  const { data: planData, missing: planMissing } = await readJsonUnknown(planFile);

  if (planMissing) {
    return { plan: null };
  }

  const validation = validateWidgetSpec(planData);

  if (validation.ok) {
    return { plan: validation.value };
  }

  const lastGoodData = await readJson(planLastGoodFile, null);
  if (lastGoodData && typeof lastGoodData === "object") {
    const migration = migrateLegacyPlan(lastGoodData, profileId);
    if (migration.ok) {
      return {
        plan: migration.value,
        warning: `Loaded last-known-good plan: ${migration.warnings?.[0] ?? "no details"}`
      };
    }
  }

  return {
    plan: null,
    warning: `Plan validation failed: ${validation.error ?? "unknown"}`
  };
};

/**
 * Save plan for a specific profile
 */
export const savePlanForProfile = async (
  profileId: string,
  plan: OverlayPlan | WidgetSpec,
  meta?: PlanSaveMeta
): Promise<WidgetSpec> => {
  const dir = await getProfileDir(profileId);
  const planFile = join(dir, PLAN_FILE);
  const planLastGoodFile = join(dir, PLAN_LAST_GOOD_FILE);
  const planHistoryFile = join(dir, PLAN_HISTORY_FILE);
  const memoryFile = join(dir, MEMORY_FILE);

  const overlayPlan = "widgets" in plan && typeof (plan as any).widgets === "object" ? (plan as OverlayPlan) : null;
  const isOverlayPlan = !!overlayPlan;

  const widgetSpec: WidgetSpec = isOverlayPlan
    ? overlayPlanToWidgetSpec(overlayPlan as OverlayPlan, profileId)
    : (plan as WidgetSpec);

  const validation = validateWidgetSpec(widgetSpec);

  if (!validation.ok) {
    throw new Error(`Plan validation failed: ${validation.error}`);
  }

  const validPlan = validation.value;
  await writeJson(planFile, validPlan);

  try {
    const memory = await readJson(memoryFile, defaultMemory);
    if (!memoryStoreSchema.safeParse(memory).success) {
      await writeJson(memoryFile, defaultMemory);
    }
  } catch {
    await writeJson(memoryFile, defaultMemory);
  }

  const snapshotId = buildSnapshotId();
  const snapshot: MemoryEntry = {
    id: `entry_${snapshotId}`,
    profileId,
    type: "plan_snapshot",
    createdAt: Date.now(),
    source: meta?.actor === "system" ? "system" : meta?.actor === "rules" ? "system" : "user",
    payload: {
      snapshotId,
      planJson: validPlan,
      reason: meta?.reason ?? "Plan saved",
      actor: meta?.actor ?? "user"
    }
  };

  const currentMemory = await readJson(memoryFile, defaultMemory);
  const sanitized = sanitizeMemoryStore({
    ...currentMemory,
    entries: [...currentMemory.entries, snapshot]
  });
  await writeJson(memoryFile, sanitized);

  try {
    await writeJson(planLastGoodFile, validPlan);
  } catch {
    // Ignore last-good write failures
  }

  try {
    const historyData = await readJson(planHistoryFile, {
      version: "1.0" as const,
      currentSnapshotId: null,
      undo: [] as string[],
      redo: [] as string[]
    });

    const entries = sanitized.entries;
    const pruned = prunePlanHistory(historyData, entries, snapshotId);

    const updated: PlanHistory = {
      version: "1.0",
      currentSnapshotId: snapshotId,
      undo: [pruned.currentSnapshotId, ...pruned.undo].filter((id): id is string => id !== null),
      redo: []
    };

    await writeJson(planHistoryFile, updated);
  } catch {
    // Ignore history update failures
  }

  return validPlan;
};

/**
 * Load memory for a specific profile
 */
export const loadMemoryForProfile = async (profileId: string): Promise<MemoryStore> => {
  const dir = await getProfileDir(profileId);
  const file = join(dir, MEMORY_FILE);

  const stored = await readJson(file, defaultMemory);

  const parseResult = memoryStoreSchema.safeParse(stored);
  if (parseResult.success) {
    const filtered: MemoryStore = {
      version: "1.0",
      entries: parseResult.data.entries.filter((entry) => (entry as any).profileId === profileId) as MemoryEntry[]
    };
    return filtered;
  }

  // Handle legacy format (no profileId field)
  const legacyResult = legacyMemoryStoreSchema.safeParse(stored);
  if (legacyResult.success) {
    const migrated: MemoryStore = {
      version: "1.0",
      entries: legacyResult.data.entries.map((entry) => ({
        ...entry,
        profileId,
        source: "user" as const,
        type: "note" as const,
        payload: { text: entry.text }
      }))
    };
    return migrated;
  }

  return defaultMemory;
};

/**
 * Save memory for a specific profile
 */
export const saveMemoryForProfile = async (profileId: string, store: MemoryStore): Promise<void> => {
  const dir = await getProfileDir(profileId);
  const file = join(dir, MEMORY_FILE);

  const filtered: MemoryStore = {
    version: "1.0",
    entries: store.entries.filter((entry) => entry.profileId === profileId)
  };

  const sanitized = sanitizeMemoryStore(filtered);
  await writeJson(file, sanitized);
};

/**
 * Load event log for a specific profile
 */
export const loadEventLogForProfile = async (profileId: string): Promise<EventLog> => {
  const dir = await getProfileDir(profileId);
  const file = join(dir, EVENT_LOG_FILE);

  const stored = await readJson(file, defaultEventLog);

  const parseResult = eventLogSchema.safeParse(stored);
  if (parseResult.success) {
    return parseResult.data;
  }

  return defaultEventLog;
};

/**
 * Save event log for a specific profile
 */
export const saveEventLogForProfile = async (profileId: string, log: EventLog): Promise<void> => {
  const dir = await getProfileDir(profileId);
  const file = join(dir, EVENT_LOG_FILE);

  await writeJson(file, log);
};

/**
 * Load rules for a specific profile
 */
export const loadRulesForProfile = async (profileId: string): Promise<RulesStore> => {
  const dir = await getProfileDir(profileId);
  const file = join(dir, RULES_FILE);

  const stored = await readJson(file, defaultRules);

  const parseResult = rulesStoreSchema.safeParse(stored);
  if (parseResult.success) {
    return parseResult.data;
  }

  return defaultRules;
};

/**
 * Save rules for a specific profile
 */
export const saveRulesForProfile = async (profileId: string, store: RulesStore): Promise<void> => {
  const dir = await getProfileDir(profileId);
  const file = join(dir, RULES_FILE);

  await writeJson(file, store);
};
