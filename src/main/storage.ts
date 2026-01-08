import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  EventLog,
  MemoryEntry,
  MemoryStore,
  OverlayPlan,
  OverlaySettings,
  PlanSaveMeta,
  PlanLoadResult,
  RulesStore
} from "../shared/ipc";
import { eventLogSchema } from "../shared/eventLogSchema";
import { memoryEntrySchema, memoryStoreSchema } from "../shared/memorySchema";
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
  rules: []
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

export const savePlan = async (plan: OverlayPlan, meta?: PlanSaveMeta): Promise<void> => {
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

export const undoPlan = async (): Promise<OverlayPlan> => {
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
  const nextValidation = overlayPlanSchema.safeParse(nextEntry.payload.planJson);
  if (!nextValidation.success) {
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
  await writeJson(backupPath, nextValidation.data as OverlayPlan);
  await writeJson(planPath, nextValidation.data as OverlayPlan);
  return nextValidation.data as OverlayPlan;
};

export const redoPlan = async (): Promise<OverlayPlan> => {
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
  const nextValidation = overlayPlanSchema.safeParse(nextEntry.payload.planJson);
  if (!nextValidation.success) {
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
  await writeJson(backupPath, nextValidation.data as OverlayPlan);
  await writeJson(planPath, nextValidation.data as OverlayPlan);
  return nextValidation.data as OverlayPlan;
};

export const rollbackPlan = async (snapshotId: string): Promise<OverlayPlan> => {
  const dir = await ensureProfileDir();
  const planPath = join(dir, PLAN_FILE);
  const backupPath = join(dir, PLAN_LAST_GOOD_FILE);

  const memory = await loadMemory();
  const entry = findSnapshotEntry(memory.entries, snapshotId);
  if (!entry) {
    throw new Error("Snapshot not found.");
  }
  const validation = overlayPlanSchema.safeParse(entry.payload.planJson);
  if (!validation.success) {
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
    let cursor = startId;
    while (true) {
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
  await writeJson(backupPath, validation.data as OverlayPlan);
  await writeJson(planPath, validation.data as OverlayPlan);
  return validation.data as OverlayPlan;
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
