import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureRoi,
  CaptureSnapshotResult,
  CaptureSource,
  CaptureSourceType,
  CounterWidget,
  DisplayInfo,
  EventLog,
  EventLogEntry,
  LlmProvider,
  LlmSettings,
  MemoryEntry,
  MemoryStore,
  OverlayPlan,
  OverlaySettings,
  Rule,
  RulesStore,
  TextWidget,
  OverlayWidget
} from "../shared/ipc";
import { overlayPlanSchema } from "../shared/planSchema";
import { defaultPlan, plannerStub } from "./planner";
import PlanRenderer from "./PlanRenderer";

const fallbackSettings: OverlaySettings = {
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

const CAPTURE_INTERVAL_MS = 15000;
const OCR_TEXT_LIMIT = 2000;
const OCR_PREVIEW_LIMIT = 140;

const emptyEventLog: EventLog = { version: "1.0", entries: [] };
const emptyMemory: MemoryStore = { version: "1.0", entries: [] };
const emptyRules: RulesStore = { version: "1.0", rules: [] };

const llmDefaults: Record<LlmProvider, { baseUrl: string; model: string; apiKey?: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.1-8b-instruct:free"
  },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2:1b" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
  custom: { baseUrl: "", model: "" }
};

const updateWidgetById = (
  widgets: OverlayWidget[],
  updated: OverlayWidget
): OverlayWidget[] => {
  return widgets.map((widget) => {
    if (widget.id === updated.id) {
      return updated;
    }
    if (widget.type === "panel") {
      return {
        ...widget,
        children: updateWidgetById(widget.children, updated)
      };
    }
    return widget;
  });
};

const buildEntryId = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `event-${Date.now()}-${suffix}`;
};

const buildRuleId = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `rule-${Date.now()}-${suffix}`;
};

const buildMemoryId = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `mem-${Date.now()}-${suffix}`;
};

const flattenWidgets = (widgets: OverlayWidget[]): OverlayWidget[] => {
  const result: OverlayWidget[] = [];
  const visit = (widget: OverlayWidget) => {
    result.push(widget);
    if (widget.type === "panel") {
      widget.children.forEach(visit);
    }
  };
  widgets.forEach(visit);
  return result;
};

const plansEqual = (a: OverlayPlan | null, b: OverlayPlan | null) =>
  Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));

const parseNumericValue = (raw: string): number | null => {
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) {
    return null;
  }
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalIndex = Math.max(lastComma, lastDot);
    const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const decimalPart = cleaned.slice(decimalIndex + 1);
    normalized = `${integerPart}.${decimalPart}`;
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const parts = cleaned.split(sep);
    const last = parts[parts.length - 1] ?? "";
    if (last.length === 3 && parts.length > 1) {
      normalized = parts.join("");
    } else {
      normalized = `${parts.slice(0, -1).join("")}.${last}`;
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const formatRateTemplate = (template: string, rate: number, unit: string, value: number, precision: number) => {
  const rateText = rate.toFixed(precision);
  const valueText = value.toFixed(precision);
  return template
    .replace(/\$\{rate\}/g, rateText)
    .replace(/\$\{unit\}/g, unit)
    .replace(/\$\{value\}/g, valueText);
};

const normalizeOcrText = (text: string) => text.replace(/\s+/g, " ").trim();

const formatCaptureError = (message: string) => {
  const lower = message.toLowerCase();
  if (lower.includes("minimized")) {
    return "Selected window is minimized. Restore it before setting ROI.";
  }
  return message;
};

const buildOcrPreview = (text: string) => {
  if (text.length <= OCR_PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, OCR_PREVIEW_LIMIT - 3)}...`;
};

const truncateText = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit - 3)}...` : value;

const formatCaptureTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type UiMode = OverlaySettings["uiMode"];
type InspectorTab = "widget" | "events" | "rules" | "memory" | "capture" | "profiles";

const App = () => {
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [plan, setPlan] = useState<OverlayPlan | null>(null);
  const [lastValidPlan, setLastValidPlan] = useState<OverlayPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planWarning, setPlanWarning] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventLog>(emptyEventLog);
  const [eventLogError, setEventLogError] = useState<string | null>(null);
  const [memoryStore, setMemoryStore] = useState<MemoryStore>(emptyMemory);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryInput, setMemoryInput] = useState("");
  const [rulesStore, setRulesStore] = useState<RulesStore>(emptyRules);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [ruleMode, setRuleMode] = useState<Rule["mode"]>("includes");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleActionType, setRuleActionType] = useState<Rule["action"]["type"]>("setTextWidget");
  const [ruleWidgetId, setRuleWidgetId] = useState("");
  const [ruleTemplate, setRuleTemplate] = useState("${text}");
  const [ruleAmount, setRuleAmount] = useState(1);
  const [captureStatus, setCaptureStatus] = useState("Capture off.");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [captureSourcesError, setCaptureSourcesError] = useState<string | null>(null);
  const [lastOcrPreview, setLastOcrPreview] = useState<string | null>(null);
  const [lastCaptureAt, setLastCaptureAt] = useState<number | null>(null);
  const [lastOcrConfidence, setLastOcrConfidence] = useState<number | null>(null);
  const [roiSnapshot, setRoiSnapshot] = useState<CaptureSnapshotResult | null>(null);
  const [roiDraft, setRoiDraft] = useState<CaptureRoi | null>(null);
  const [roiError, setRoiError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [plannerNote, setPlannerNote] = useState("Ready.");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("widget");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const overlayAPI = window.overlayAPI;
  const defaultPlanMemo = useMemo(() => defaultPlan(), []);
  const captureInFlightRef = useRef(false);
  const skipNextCaptureRef = useRef(false);
  const roiImageRef = useRef<HTMLImageElement | null>(null);
  const roiDragRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0
  });
  const uiMode: UiMode = settings?.uiMode ?? "gameplay";
  const loadCaptureSources = useCallback(async () => {
    if (!overlayAPI || typeof overlayAPI.listCaptureSources !== "function") {
      setCaptureSourcesError("Capture source API not available. Restart Electron.");
      setCaptureSources([]);
      return;
    }
    try {
      const sources = await overlayAPI.listCaptureSources();
      setCaptureSources(sources);
      setCaptureSourcesError(null);
    } catch (error: unknown) {
      setCaptureSourcesError(
        error instanceof Error ? error.message : "Failed to load capture sources."
      );
      setCaptureSources([]);
    }
  }, [overlayAPI]);

  useEffect(() => {
    const bootstrap = async () => {
      if (!overlayAPI) {
        setPlannerNote("Preload bridge not loaded. Restart dev server after rebuilding Electron.");
        setSettings(fallbackSettings);
        setPlan(defaultPlanMemo);
        setEventLog(emptyEventLog);
        return;
      }

      const [settingsResult, displaysResult, planResult] = await Promise.allSettled([
        overlayAPI.getSettings(),
        overlayAPI.getDisplays(),
        overlayAPI.loadPlan()
      ]);

      if (settingsResult.status === "fulfilled") {
        setSettings(settingsResult.value);
      } else {
        setSettings(fallbackSettings);
        setPlannerNote(
          `Failed to load settings. ${settingsResult.reason instanceof Error ? settingsResult.reason.message : ""}`.trim()
        );
      }

      if (displaysResult.status === "fulfilled") {
        setDisplays(displaysResult.value);
      } else {
        setDisplays([]);
      }

      if (planResult.status === "fulfilled") {
        const stored = planResult.value;
        if (stored.warning) {
          setPlanWarning(stored.warning);
        }
        if (stored.plan) {
          const hasPhase2Widgets = stored.plan.widgets.some((widget) => {
            if (widget.type === "eventLog" || widget.type === "rate" || widget.type === "projection") {
              return true;
            }
            if (widget.type === "panel") {
              return widget.children.some(
                (child) =>
                  child.type === "eventLog" || child.type === "rate" || child.type === "projection"
              );
            }
            return false;
          });
          if (!hasPhase2Widgets) {
            setPlannerNote("Loaded saved plan. Tip: type 'reset' to load Phase 2 widgets.");
          }
          setPlan(stored.plan);
        } else {
          const initialPlan = defaultPlanMemo;
          setPlan(initialPlan);
          await overlayAPI.savePlan(initialPlan);
        }
      } else {
        const initialPlan = defaultPlanMemo;
        setPlan(initialPlan);
        overlayAPI.savePlan(initialPlan).catch(() => undefined);
      }

      if (typeof overlayAPI.loadEventLog === "function") {
        try {
          const loadedEventLog = await overlayAPI.loadEventLog();
          setEventLog(loadedEventLog);
          setEventLogError(null);
        } catch (error: unknown) {
          setEventLog(emptyEventLog);
          setEventLogError(
            error instanceof Error
              ? error.message
              : "Failed to load event log. Restart Electron to load updated IPC handlers."
          );
        }
      } else {
        setEventLog(emptyEventLog);
        setEventLogError("Event log API not available. Restart Electron to load updated IPC handlers.");
      }

      if (typeof overlayAPI.loadMemory === "function") {
        try {
          const loadedMemory = await overlayAPI.loadMemory();
          setMemoryStore(loadedMemory);
          setMemoryError(null);
        } catch (error: unknown) {
          setMemoryStore(emptyMemory);
          setMemoryError(error instanceof Error ? error.message : "Failed to load memory.");
        }
      } else {
        setMemoryStore(emptyMemory);
        setMemoryError("Memory API not available. Restart Electron to load updated IPC handlers.");
      }

      if (typeof overlayAPI.loadRules === "function") {
        try {
          const loadedRules = await overlayAPI.loadRules();
          setRulesStore(loadedRules);
          setRulesError(null);
        } catch (error: unknown) {
          setRulesStore(emptyRules);
          setRulesError(error instanceof Error ? error.message : "Failed to load rules.");
        }
      } else {
        setRulesStore(emptyRules);
        setRulesError("Rules API not available. Restart Electron to load updated IPC handlers.");
      }
    };
    bootstrap().catch((error: unknown) => {
      setSettings(fallbackSettings);
      setPlan(defaultPlanMemo);
      setEventLog(emptyEventLog);
      setPlannerNote(error instanceof Error ? error.message : "Bootstrap failed.");
    });
  }, [overlayAPI, defaultPlanMemo]);

  useEffect(() => {
    if (!plan) {
      return;
    }
    const result = overlayPlanSchema.safeParse(plan);
    if (result.success) {
      setLastValidPlan(plan);
      setPlanError(null);
    } else {
      setPlanError(result.error.errors.map((err) => err.message).join("; "));
    }
  }, [plan]);

  useEffect(() => {
    if (!overlayAPI) {
      return;
    }
    return overlayAPI.onEscapeHatch(() => {
      setPlannerNote("Escape hatch used: overlay unlocked.");
      setSettings((prev) => (prev ? { ...prev, clickThrough: false } : prev));
    });
  }, [overlayAPI]);

  useEffect(() => {
    if (!overlayAPI) {
      return;
    }
    loadCaptureSources().catch(() => undefined);
  }, [overlayAPI, loadCaptureSources]);

  const activePlan = useMemo(
    () => lastValidPlan ?? plan ?? defaultPlanMemo,
    [lastValidPlan, plan, defaultPlanMemo]
  );

  const saveSettings = async (next: OverlaySettings) => {
    setSettings(next);
    if (!overlayAPI) {
      return;
    }
    await overlayAPI.saveSettings(next);
  };

  const updateLlmSettings = (next: Partial<LlmSettings>) => {
    if (!settings) {
      return;
    }
    saveSettings({ ...settings, llm: { ...settings.llm, ...next } });
  };

  const handleLlmProviderChange = (provider: LlmProvider) => {
    const defaults = llmDefaults[provider];
    updateLlmSettings({
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model
    });
  };

  const handleUndoPlan = async () => {
    if (!overlayAPI || typeof overlayAPI.undoPlan !== "function") {
      setPlanError("Undo API not available. Restart Electron.");
      return;
    }
    try {
      const next = await overlayAPI.undoPlan();
      setPlan(next);
      setLastValidPlan(next);
      setPlanError(null);
    } catch (error: unknown) {
      setPlanError(error instanceof Error ? error.message : "Undo failed.");
    }
  };

  const handleRedoPlan = async () => {
    if (!overlayAPI || typeof overlayAPI.redoPlan !== "function") {
      setPlanError("Redo API not available. Restart Electron.");
      return;
    }
    try {
      const next = await overlayAPI.redoPlan();
      setPlan(next);
      setLastValidPlan(next);
      setPlanError(null);
    } catch (error: unknown) {
      setPlanError(error instanceof Error ? error.message : "Redo failed.");
    }
  };

  const handleOpacityChange = (value: number) => {
    if (!settings) {
      return;
    }
    saveSettings({ ...settings, opacity: value });
  };

  const handleClickThroughToggle = () => {
    if (!settings) {
      return;
    }
    saveSettings({ ...settings, clickThrough: !settings.clickThrough });
  };

  const handleDisplayChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const displayId = Number(event.target.value);
    if (overlayAPI) {
      await overlayAPI.setDisplay(displayId);
    }
    if (settings) {
      saveSettings({ ...settings, displayId });
    }
  };

  const handleModeChange = (next: UiMode) => {
    if (!settings) {
      return;
    }
    if (next === "inspect") {
      setInspectorCollapsed(false);
    }
    saveSettings({ ...settings, uiMode: next });
  };

  const handleCaptureSourceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!settings) {
      return;
    }
    const value = event.target.value;
    if (!value) {
      saveSettings({
        ...settings,
        captureSourceId: null,
        captureSourceType: null,
        captureRoi: null
      });
      return;
    }
    const [type, ...rest] = value.split(":");
    const id = rest.join(":");
    if (!id || (type !== "display" && type !== "window")) {
      setCaptureError("Invalid capture source selected.");
      return;
    }
    setCaptureError(null);
    saveSettings({
      ...settings,
      captureSourceType: type as CaptureSourceType,
      captureSourceId: id,
      captureRoi: null
    });
  };

  const closeRoiModal = () => {
    setRoiSnapshot(null);
    setRoiDraft(null);
    setRoiError(null);
    roiDragRef.current.active = false;
  };

  const startRoiSelection = async () => {
    if (!settings?.captureSourceType || !settings.captureSourceId) {
      setCaptureError("Select a capture source before setting ROI.");
      return;
    }
    if (!overlayAPI || typeof overlayAPI.captureSnapshot !== "function") {
      setCaptureError("ROI snapshot API not available. Restart Electron.");
      return;
    }
    setCaptureError(null);
    setRoiError(null);
    setRoiDraft(null);
    try {
      const snapshot = await overlayAPI.captureSnapshot({
        type: settings.captureSourceType,
        id: settings.captureSourceId
      });
      setRoiSnapshot(snapshot);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to capture snapshot.";
      setCaptureError(formatCaptureError(message));
    }
  };

  const saveRoi = async () => {
    if (!settings) {
      return;
    }
    if (!roiDraft) {
      setRoiError("Drag to select an ROI before saving.");
      return;
    }
    if (roiDraft.width < 0.01 || roiDraft.height < 0.01) {
      setRoiError("ROI is too small. Drag a larger region.");
      return;
    }
    setRoiError(null);
    await saveSettings({ ...settings, captureRoi: roiDraft });
    closeRoiModal();
  };

  const clearRoi = async () => {
    if (!settings) {
      return;
    }
    await saveSettings({ ...settings, captureRoi: null });
    setRoiError(null);
    closeRoiModal();
  };

  const getRoiNormalizedPoint = (clientX: number, clientY: number) => {
    const img = roiImageRef.current;
    if (!img) {
      return null;
    }
    const rect = img.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y))
    };
  };

  const handleRoiPointerDown = (event: React.PointerEvent) => {
    const point = getRoiNormalizedPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    roiDragRef.current = { active: true, startX: point.x, startY: point.y };
    setRoiDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handleRoiPointerMove = (event: React.PointerEvent) => {
    if (!roiDragRef.current.active) {
      return;
    }
    const point = getRoiNormalizedPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const startX = roiDragRef.current.startX;
    const startY = roiDragRef.current.startY;
    const x = Math.min(startX, point.x);
    const y = Math.min(startY, point.y);
    const width = Math.abs(point.x - startX);
    const height = Math.abs(point.y - startY);
    setRoiDraft({ x, y, width, height });
  };

  const handleRoiPointerUp = (event: React.PointerEvent) => {
    if (!roiDragRef.current.active) {
      return;
    }
    roiDragRef.current.active = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handleCaptureToggle = () => {
    if (!settings) {
      return;
    }
    if (!settings.captureEnabled) {
      if (!overlayAPI || typeof overlayAPI.captureAndProcess !== "function") {
        setCaptureError("Capture API not available. Restart Electron to load updated IPC handlers.");
        return;
      }
      if (!settings.captureSourceType || !settings.captureSourceId) {
        setCaptureError("Select a capture source before enabling capture.");
        return;
      }
      const confirmed = window.confirm(
        "Enable screen capture for OCR?\nCaptures are stored locally while enabled."
      );
      if (!confirmed) {
        return;
      }
      skipNextCaptureRef.current = true;
      captureOnce({
        type: settings.captureSourceType,
        id: settings.captureSourceId
      }).catch(() => undefined);
    }
    if (settings.captureEnabled) {
      overlayAPI?.stopCapture?.();
    }
    saveSettings({ ...settings, captureEnabled: !settings.captureEnabled });
  };

  const handleWidgetUpdate = (updated: OverlayWidget) => {
    if (!plan) {
      return;
    }
    const next = { ...plan, widgets: updateWidgetById(plan.widgets, updated) };
    setPlan(next);
    overlayAPI?.savePlan(next).catch((error: unknown) => {
      setPlanError(error instanceof Error ? error.message : "Failed to save plan.");
    });
  };

  const persistEventLog = useCallback(async (next: EventLog) => {
    if (!overlayAPI || typeof overlayAPI.saveEventLog !== "function") {
      setEventLogError("Event log API not available. Restart Electron to load updated IPC handlers.");
      return;
    }
    try {
      await overlayAPI.saveEventLog(next);
      setEventLogError(null);
    } catch (error: unknown) {
      setEventLogError(
        error instanceof Error ? error.message : "Failed to save event log."
      );
    }
  }, [overlayAPI]);

  const persistMemory = useCallback(
    async (next: MemoryStore) => {
      if (!overlayAPI || typeof overlayAPI.saveMemory !== "function") {
        setMemoryError("Memory API not available. Restart Electron to load updated IPC handlers.");
        return;
      }
      try {
        await overlayAPI.saveMemory(next);
        setMemoryError(null);
      } catch (error: unknown) {
        setMemoryError(error instanceof Error ? error.message : "Failed to save memory.");
      }
    },
    [overlayAPI]
  );

  const persistRules = useCallback(
    async (next: RulesStore) => {
      if (!overlayAPI || typeof overlayAPI.saveRules !== "function") {
        setRulesError("Rules API not available. Restart Electron to load updated IPC handlers.");
        return;
      }
      try {
        await overlayAPI.saveRules(next);
        setRulesError(null);
      } catch (error: unknown) {
        setRulesError(error instanceof Error ? error.message : "Failed to save rules.");
      }
    },
    [overlayAPI]
  );

  const handleAddEventEntry = useCallback((entry: EventLogEntry) => {
    setEventLog((prev) => {
      const next = { ...prev, entries: [...prev.entries, entry] };
      persistEventLog(next).catch(() => undefined);
      return next;
    });
  }, [persistEventLog]);

  const handleAddMemoryEntry = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const entry: MemoryEntry = { id: buildMemoryId(), createdAt: Date.now(), text: trimmed };
      setMemoryStore((prev) => {
        const next = { ...prev, entries: [entry, ...prev.entries].slice(0, 200) };
        persistMemory(next).catch(() => undefined);
        return next;
      });
    },
    [persistMemory]
  );

  const handleDeleteMemoryEntry = useCallback(
    (id: string) => {
      setMemoryStore((prev) => {
        const next = { ...prev, entries: prev.entries.filter((entry) => entry.id !== id) };
        persistMemory(next).catch(() => undefined);
        return next;
      });
    },
    [persistMemory]
  );

  const validateRule = (rule: Rule) => {
    if (!rule.pattern.trim()) {
      return "Pattern is required.";
    }
    if (!rule.action.widgetId.trim()) {
      return "Select a widget.";
    }
    if (rule.mode === "regex") {
      try {
        new RegExp(rule.pattern, "i");
      } catch (error: unknown) {
        return error instanceof Error ? error.message : "Invalid regex pattern.";
      }
    }
    if (rule.action.type === "setTextWidget" && !rule.action.template.trim()) {
      return "Template is required.";
    }
    return null;
  };

  const handleAddRule = useCallback(() => {
    const nextRule: Rule =
      ruleActionType === "incrementCounter"
        ? {
            id: buildRuleId(),
            enabled: true,
            mode: ruleMode,
            pattern: rulePattern,
            action: { type: "incrementCounter", widgetId: ruleWidgetId, amount: ruleAmount }
          }
        : {
            id: buildRuleId(),
            enabled: true,
            mode: ruleMode,
            pattern: rulePattern,
            action: { type: "setTextWidget", widgetId: ruleWidgetId, template: ruleTemplate }
          };

    const validationError = validateRule(nextRule);
    if (validationError) {
      setRulesError(validationError);
      return;
    }

    setRulesStore((prev) => {
      const next = { ...prev, rules: [nextRule, ...prev.rules] };
      persistRules(next).catch(() => undefined);
      return next;
    });
    setRulePattern("");
    setRulesError(null);
  }, [
    persistRules,
    ruleActionType,
    ruleAmount,
    ruleMode,
    rulePattern,
    ruleTemplate,
    ruleWidgetId
  ]);

  const handleToggleRule = useCallback(
    (id: string) => {
      setRulesStore((prev) => {
        const next = {
          ...prev,
          rules: prev.rules.map((rule) =>
            rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
          )
        };
        persistRules(next).catch(() => undefined);
        return next;
      });
    },
    [persistRules]
  );

  const handleDeleteRule = useCallback(
    (id: string) => {
      setRulesStore((prev) => {
        const next = { ...prev, rules: prev.rules.filter((rule) => rule.id !== id) };
        persistRules(next).catch(() => undefined);
        return next;
      });
    },
    [persistRules]
  );

  const applyRulesFromOcr = useCallback(
    async (ocrText: string, capturedAt: number) => {
      if (!plan || !overlayAPI || typeof overlayAPI.savePlan !== "function") {
        return;
      }
      const passiveText = normalizeOcrText(ocrText);
      if (!passiveText) {
        return;
      }
      const enabledRules = rulesStore.rules.filter((rule) => rule.enabled);
      if (enabledRules.length === 0) {
        return;
      }

      const interpolate = (template: string, match0: string, groups: string[]) => {
        return template
          .replace(/\$\{text\}/g, passiveText)
          .replace(/\$\{match0\}/g, match0)
          .replace(/\$\{g(\d+)\}/g, (_whole, index: string) => {
            const i = Number(index);
            if (!Number.isFinite(i) || i <= 0) {
              return "";
            }
            return groups[i - 1] ?? "";
          });
      };

      const findWidgetById = (widgets: OverlayWidget[], id: string): OverlayWidget | undefined => {
        for (const widget of widgets) {
          if (widget.id === id) {
            return widget;
          }
          if (widget.type === "panel") {
            const child = findWidgetById(widget.children, id);
            if (child) {
              return child;
            }
          }
        }
        return undefined;
      };

      let nextPlan: OverlayPlan = plan;
      const fired: Rule[] = [];
      let rulesChanged = false;

      const updatedRules = rulesStore.rules.map((rule) => {
        if (!rule.enabled) {
          return rule;
        }

        let match0 = "";
        let groups: string[] = [];

        if (rule.mode === "includes") {
          if (!passiveText.toLowerCase().includes(rule.pattern.toLowerCase())) {
            return rule;
          }
          match0 = rule.pattern;
        } else {
          let regex: RegExp;
          try {
            regex = new RegExp(rule.pattern, "i");
          } catch {
            return rule;
          }
          const match = regex.exec(passiveText);
          if (!match) {
            return rule;
          }
          match0 = match[0] ?? "";
          groups = match.slice(1).map((value) => value ?? "");
        }

        const target = findWidgetById(nextPlan.widgets, rule.action.widgetId);
        if (!target) {
          return rule;
        }

        if (rule.action.type === "setTextWidget" && target.type === "text") {
          const updated: TextWidget = {
            ...target,
            text: interpolate(rule.action.template, match0, groups)
          };
          nextPlan = { ...nextPlan, widgets: updateWidgetById(nextPlan.widgets, updated) };
          fired.push(rule);
          return rule;
        }

        if (rule.action.type === "incrementCounter" && target.type === "counter") {
          const updated: CounterWidget = {
            ...target,
            value: target.value + rule.action.amount
          };
          nextPlan = { ...nextPlan, widgets: updateWidgetById(nextPlan.widgets, updated) };
          fired.push(rule);
          return rule;
        }

        if (rule.action.type === "trackRate" && target.type === "text") {
          const valueSource = rule.action.valueSource ?? "match0";
          const valueRaw = valueSource === "g1" ? groups[0] ?? match0 : match0;
          const currentValue = parseNumericValue(valueRaw);
          if (currentValue === null) {
            return rule;
          }

          const previousValue = rule.state?.lastValue;
          const previousAt = rule.state?.lastAt;
          const minSeconds = rule.action.minSeconds ?? 60;
          const precision = rule.action.precision ?? 2;
          const unit = rule.action.unit ?? "";

          if (previousValue !== undefined && previousAt !== undefined) {
            const deltaMs = capturedAt - previousAt;
            if (deltaMs >= minSeconds * 1000 && deltaMs > 0) {
              const rate = (currentValue - previousValue) / (deltaMs / 3600000);
              const text = formatRateTemplate(
                rule.action.template,
                rate,
                unit,
                currentValue,
                precision
              );
              const updated: TextWidget = { ...target, text };
              nextPlan = { ...nextPlan, widgets: updateWidgetById(nextPlan.widgets, updated) };
              fired.push(rule);
            }
          }

          const nextState = { lastValue: currentValue, lastAt: capturedAt };
          const stateChanged =
            rule.state?.lastValue !== nextState.lastValue || rule.state?.lastAt !== nextState.lastAt;
          if (!stateChanged) {
            return rule;
          }
          rulesChanged = true;
          return { ...rule, state: nextState };
        }

        return rule;
      });

      if (rulesChanged) {
        const nextRulesStore = { ...rulesStore, rules: updatedRules };
        setRulesStore(nextRulesStore);
        persistRules(nextRulesStore).catch(() => undefined);
      }

      if (!fired.length || plansEqual(plan, nextPlan)) {
        return;
      }

      try {
        await overlayAPI.savePlan(nextPlan);
        setPlan(nextPlan);
        setLastValidPlan(nextPlan);

        const entry: EventLogEntry = {
          id: buildEntryId(),
          eventType: "rule",
          timestamp: capturedAt,
          note: `Rules fired: ${fired.map((rule) => rule.id).join(", ")}`,
          data: { text: passiveText, capturedAt }
        };
        handleAddEventEntry(entry);
      } catch {
        // If save fails, don't surface it as OCR error.
      }
    },
    [handleAddEventEntry, overlayAPI, persistRules, plan, rulesStore]
  );

  const captureOnce = useCallback(
    async (target: { id: string; type: CaptureSourceType } | null) => {
      if (captureInFlightRef.current) {
        return;
      }
      if (!overlayAPI || typeof overlayAPI.captureAndProcess !== "function") {
        setCaptureError("Capture API not available. Restart Electron to load updated IPC handlers.");
        return;
      }
      if (!target) {
        setCaptureError("Select a capture source before enabling capture.");
        return;
      }
      captureInFlightRef.current = true;
      setCaptureStatus("Capture running.");
      try {
        const result = await overlayAPI.captureAndProcess(target);
        if (!result) {
          setCaptureError("No screen sources available for capture.");
          return;
        }
        const normalized = normalizeOcrText(result.text);
        const trimmed = normalized.slice(0, OCR_TEXT_LIMIT);
        const preview = trimmed ? buildOcrPreview(trimmed) : "No text detected.";
        setLastOcrPreview(preview);
        setLastCaptureAt(result.capturedAt);
        setLastOcrConfidence(result.confidence);
        if (result.error) {
          setCaptureError(result.error);
        } else {
          setCaptureError(null);
        }
        const entry: EventLogEntry = {
          id: buildEntryId(),
          eventType: "ocr",
          timestamp: result.capturedAt,
          note: preview,
          data: {
            text: trimmed,
            confidence: result.confidence,
            capturePath: result.capturePath,
            sourceName: result.sourceName,
            capturedAt: result.capturedAt
          }
        };
        handleAddEventEntry(entry);
        applyRulesFromOcr(result.text, result.capturedAt).catch(() => undefined);
      } catch (error: unknown) {
        const detail =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Capture failed.";
        setCaptureStatus("Capture error.");
        setCaptureError(detail);
        console.error("[capture] failed", error);
      } finally {
        captureInFlightRef.current = false;
      }
    },
    [applyRulesFromOcr, handleAddEventEntry, overlayAPI]
  );

  useEffect(() => {
    if (!settings?.captureEnabled) {
      setCaptureStatus("Capture off.");
      setCaptureError(null);
      return;
    }
    if (!overlayAPI || typeof overlayAPI.captureAndProcess !== "function") {
      setCaptureStatus("Capture unavailable.");
      setCaptureError("Capture API not available. Restart Electron to load updated IPC handlers.");
      return;
    }
    const target =
      settings.captureSourceType && settings.captureSourceId
        ? { type: settings.captureSourceType, id: settings.captureSourceId }
        : null;

    if (skipNextCaptureRef.current) {
      skipNextCaptureRef.current = false;
    } else {
      captureOnce(target).catch(() => undefined);
    }
    const timer = setInterval(() => {
      captureOnce(target).catch(() => undefined);
    }, CAPTURE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [
    captureOnce,
    overlayAPI,
    settings?.captureEnabled,
    settings?.captureSourceId,
    settings?.captureSourceType
  ]);

  const displaySources = useMemo(
    () => captureSources.filter((source) => source.type === "display"),
    [captureSources]
  );
  const windowSources = useMemo(
    () => captureSources.filter((source) => source.type === "window"),
    [captureSources]
  );
  const flatWidgets = useMemo(
    () => (activePlan ? flattenWidgets(activePlan.widgets) : []),
    [activePlan]
  );
  const textWidgets = useMemo(
    () => flatWidgets.filter((widget) => widget.type === "text") as TextWidget[],
    [flatWidgets]
  );
  const counterWidgets = useMemo(
    () => flatWidgets.filter((widget) => widget.type === "counter") as CounterWidget[],
    [flatWidgets]
  );
  useEffect(() => {
    if (flatWidgets.length === 0) {
      setSelectedWidgetId(null);
      return;
    }
    if (!selectedWidgetId || !flatWidgets.some((widget) => widget.id === selectedWidgetId)) {
      setSelectedWidgetId(flatWidgets[0].id);
    }
  }, [flatWidgets, selectedWidgetId]);
  const llmHelp = useMemo(() => {
    const provider = settings?.llm.provider ?? "ollama";
    if (provider === "ollama") {
      return (
        <div className="llm-help">
          <p>Local setup (Ollama):</p>
          <ol>
            <li>Install: https://ollama.com/download</li>
            <li>Run: <code>ollama run llama3.2:1b</code></li>
            <li>Base URL: <code>http://127.0.0.1:11434/v1</code></li>
            <li>Enable LLM Composer.</li>
          </ol>
        </div>
      );
    }
    if (provider === "lmstudio") {
      return (
        <div className="llm-help">
          <p>Local setup (LM Studio):</p>
          <ol>
            <li>Install: https://lmstudio.ai</li>
            <li>Download a small model (1B/3B).</li>
            <li>Start the OpenAI-compatible server.</li>
            <li>Base URL: <code>http://localhost:1234/v1</code></li>
          </ol>
        </div>
      );
    }
    if (provider === "openrouter") {
      return (
        <div className="llm-help">
          <p>OpenRouter setup:</p>
          <ol>
            <li>Enter your API key.</li>
            <li>Pick a valid model from openrouter.ai/models.</li>
          </ol>
        </div>
      );
    }
    if (provider === "groq") {
      return (
        <div className="llm-help">
          <p>Groq setup:</p>
          <ol>
            <li>Enter your API key.</li>
            <li>Model example: <code>llama-3.1-8b-instant</code></li>
          </ol>
        </div>
      );
    }
    if (provider === "mistral" || provider === "openai") {
      return (
        <div className="llm-help">
          <p>Cloud setup:</p>
          <ol>
            <li>Enter your API key.</li>
            <li>Make sure your account has credits.</li>
          </ol>
        </div>
      );
    }
    return (
      <div className="llm-help">
        <p>Custom provider:</p>
        <ol>
          <li>Set Base URL and Model.</li>
          <li>API key is required for hosted providers.</li>
        </ol>
      </div>
    );
  }, [settings?.llm.provider]);
  const captureSourceValue =
    settings?.captureSourceId && settings?.captureSourceType
      ? `${settings.captureSourceType}:${settings.captureSourceId}`
      : "";
  const selectedWidget = useMemo(
    () => flatWidgets.find((widget) => widget.id === selectedWidgetId) ?? null,
    [flatWidgets, selectedWidgetId]
  );
  const recentEventEntries = useMemo(
    () => eventLog.entries.slice(-20).reverse(),
    [eventLog.entries]
  );

  const handleChatSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!plan || !trimmed) {
      return;
    }
    setChatInput("");

    if (trimmed.toLowerCase() === "reset") {
      const resetPlan = defaultPlanMemo;
      setPlan(resetPlan);
      setLastValidPlan(resetPlan);
      setPlanError(null);
      setPlanWarning(null);
      setRulesStore(emptyRules);
      setLlmError(null);
      setPlannerNote("Plan reset to defaults.");
      if (overlayAPI) {
        await overlayAPI.savePlan(resetPlan);
        await overlayAPI.saveRules(emptyRules);
      }
      return;
    }

    if (settings?.llm.enabled && overlayAPI && typeof overlayAPI.composePlan === "function") {
      try {
        const result = await overlayAPI.composePlan({
          message: trimmed,
          plan: plan ?? defaultPlanMemo,
          rules: rulesStore
        });
        setPlannerNote(result.note || "Planner updated the plan.");
        setPlan(result.plan);
        setLastValidPlan(result.plan);
        setRulesStore(result.rules);
        setPlanError(null);
        setPlanWarning(null);
        setLlmError(null);
        return;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Planner request failed.";
        setPlannerNote(message);
        setLlmError(message);
        return;
      }
    }

    const result = plannerStub(trimmed, plan);
    setPlannerNote(result.note);
    setLlmError(null);
    const validation = overlayPlanSchema.safeParse(result.plan);
    if (validation.success) {
      setPlan(result.plan);
      setLastValidPlan(result.plan);
      setPlanError(null);
      setPlanWarning(null);
      if (overlayAPI) {
        await overlayAPI.savePlan(result.plan);
      }
    } else {
      setPlanError(validation.error.errors.map((err) => err.message).join("; "));
    }
  };

  const renderWidgetDetails = (widget: OverlayWidget) => {
    switch (widget.type) {
      case "text":
        return (
          <div className="detail-row">
            <span className="detail-label">Text</span>
            <span className="detail-value">{truncateText(widget.text, 140)}</span>
          </div>
        );
      case "counter":
        return (
          <>
            <div className="detail-row">
              <span className="detail-label">Value</span>
              <span className="detail-value">{widget.value}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Step</span>
              <span className="detail-value">{widget.step}</span>
            </div>
          </>
        );
      case "timer":
        return (
          <>
            <div className="detail-row">
              <span className="detail-label">Seconds</span>
              <span className="detail-value">{widget.seconds}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Running</span>
              <span className="detail-value">{widget.running ? "Yes" : "No"}</span>
            </div>
          </>
        );
      case "checklist": {
        const checkedCount = widget.items.filter((item) => item.checked).length;
        return (
          <>
            <div className="detail-row">
              <span className="detail-label">Items</span>
              <span className="detail-value">{widget.items.length}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Checked</span>
              <span className="detail-value">{checkedCount}</span>
            </div>
          </>
        );
      }
      case "panel":
        return (
          <div className="detail-row">
            <span className="detail-label">Children</span>
            <span className="detail-value">{widget.children.length}</span>
          </div>
        );
      case "eventLog":
        return (
          <>
            <div className="detail-row">
              <span className="detail-label">Event Type</span>
              <span className="detail-value">{widget.eventType}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Show Last</span>
              <span className="detail-value">{widget.showLast}</span>
            </div>
          </>
        );
      case "rate":
        return (
          <>
            <div className="detail-row">
              <span className="detail-label">Event Type</span>
              <span className="detail-value">{widget.eventType}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Lookback</span>
              <span className="detail-value">{widget.lookbackMinutes} min</span>
            </div>
          </>
        );
      case "projection":
        return (
          <>
            <div className="detail-row">
              <span className="detail-label">Event Type</span>
              <span className="detail-value">{widget.eventType}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Lookback</span>
              <span className="detail-value">{widget.lookbackMinutes} min</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Horizon</span>
              <span className="detail-value">{widget.horizonMinutes} min</span>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-root" data-mode={uiMode}>
      <header className="top-bar">
        <div className="runtime-controls">
          <div className="control-group">
            <span className="label">Opacity</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.02}
              value={settings?.opacity ?? 0.92}
              onChange={(event) => handleOpacityChange(Number(event.target.value))}
            />
          </div>
          <button type="button" onClick={handleClickThroughToggle}>
            {settings?.clickThrough ? "Unlock (Interactive)" : "Lock (Click-through)"}
          </button>
          <div className="control-group">
            <span className="label">Display</span>
            <select value={settings?.displayId ?? ""} onChange={handleDisplayChange}>
              <option value="" disabled>
                Choose display
              </option>
              {displays.map((display) => (
                <option key={display.id} value={display.id}>
                  {display.label}
                </option>
              ))}
            </select>
          </div>
          <div className="control-group">
            <span className="label">Capture</span>
            <button
              type="button"
              className={settings?.captureEnabled ? "capture-button on" : "capture-button off"}
              onClick={handleCaptureToggle}
            >
              {settings?.captureEnabled ? "Disable" : "Enable"}
            </button>
          </div>
        </div>
        <div className="top-bar-right">
          <div className="mode-switch">
            <span className="label">Mode</span>
            <div className="mode-buttons">
              <button
                type="button"
                className={uiMode === "gameplay" ? "active" : ""}
                onClick={() => handleModeChange("gameplay")}
                disabled={!settings}
              >
                Gameplay
              </button>
              <button
                type="button"
                className={uiMode === "inspect" ? "active" : ""}
                onClick={() => handleModeChange("inspect")}
                disabled={!settings}
              >
                Inspect
              </button>
              <button
                type="button"
                className={uiMode === "compose" ? "active" : ""}
                onClick={() => handleModeChange("compose")}
                disabled={!settings}
              >
                Compose
              </button>
            </div>
          </div>
          <div className="escape-hatch">
            Escape Hatch: <strong>Ctrl + Shift + O</strong>
          </div>
        </div>
      </header>

      <main className="content">
        <section className="widget-canvas">
          {activePlan && (
            <PlanRenderer
              plan={activePlan}
              eventLog={eventLog}
              onAddEventEntry={handleAddEventEntry}
              onUpdate={handleWidgetUpdate}
            />
          )}
        </section>

        {uiMode === "compose" && (
          <aside className="side-panel composer-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Composer / AI</div>
                <div className="panel-subtitle">Plan composition and validation</div>
              </div>
            </div>
            <div className="panel-scroll">
              <div className="panel-section">
                <h3>Status</h3>
                <p className="planner-note">{plannerNote}</p>
                {planWarning && <p className="status-warning">{planWarning}</p>}
                {planError && (
                  <p className="status-error">
                    Plan validation failed. Keeping last valid plan. {planError}
                  </p>
                )}
              </div>
              <div className="panel-section">
                <h3>Plan Tools</h3>
                <div className="plan-buttons">
                  <button type="button" onClick={handleUndoPlan}>
                    Undo
                  </button>
                  <button type="button" onClick={handleRedoPlan}>
                    Redo
                  </button>
                </div>
              </div>
              <div className="panel-section">
                <h3>Compose</h3>
                <form onSubmit={handleChatSubmit}>
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Try: text: Welcome to the raid"
                    rows={6}
                  />
                  <button type="submit">Compose Plan</button>
                </form>
                <div className="chat-hints">
                  <p>Planner commands:</p>
                  <ul>
                    <li><strong>reset</strong> - restore default overlay plan</li>
                    <li><strong>text: ...</strong> - create a text-only plan</li>
                  </ul>
                </div>
              </div>
              <div className="llm-panel">
                <h3>AI Provider</h3>
                <label className="llm-toggle">
                  <input
                    type="checkbox"
                    checked={settings?.llm.enabled ?? false}
                    onChange={(event) => updateLlmSettings({ enabled: event.target.checked })}
                  />
                  <span>Enable LLM Composer</span>
                </label>
                {llmError && <p className="capture-error">{llmError}</p>}
                <div className="llm-form">
                  <select
                    value={settings?.llm.provider ?? "ollama"}
                    onChange={(event) => handleLlmProviderChange(event.target.value as LlmProvider)}
                  >
                    <option value="ollama">Ollama (local)</option>
                    <option value="lmstudio">LM Studio (local)</option>
                    <option value="openai">OpenAI</option>
                    <option value="groq">Groq</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="mistral">Mistral</option>
                    <option value="custom">Custom</option>
                  </select>
                  <input
                    value={settings?.llm.baseUrl ?? ""}
                    onChange={(event) => updateLlmSettings({ baseUrl: event.target.value })}
                    placeholder="Base URL"
                  />
                  <input
                    value={settings?.llm.model ?? ""}
                    onChange={(event) => updateLlmSettings({ model: event.target.value })}
                    placeholder="Model"
                  />
                  <input
                    type="password"
                    value={settings?.llm.apiKey ?? ""}
                    onChange={(event) => updateLlmSettings({ apiKey: event.target.value })}
                    placeholder="API key (optional for local)"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const provider = settings?.llm.provider ?? "ollama";
                      const defaults = llmDefaults[provider];
                      updateLlmSettings({
                        baseUrl: defaults.baseUrl,
                        model: defaults.model,
                        apiKey: defaults.apiKey ?? ""
                      });
                    }}
                  >
                    Use defaults
                  </button>
                </div>
                {llmHelp}
              </div>
            </div>
          </aside>
        )}
        {uiMode === "inspect" && (
          <aside className={`side-panel inspector-panel${inspectorCollapsed ? " collapsed" : ""}`}>
            <div className="panel-header">
              <div className="panel-title">Inspector</div>
              <button type="button" onClick={() => setInspectorCollapsed((prev) => !prev)}>
                {inspectorCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
            {!inspectorCollapsed && (
              <>
                <div className="panel-tabs">
                  {(["widget", "events", "rules", "memory", "capture", "profiles"] as InspectorTab[]).map(
                    (tab) => (
                      <button
                        key={tab}
                        type="button"
                        className={inspectorTab === tab ? "active" : ""}
                        onClick={() => setInspectorTab(tab)}
                      >
                        {tab === "widget"
                          ? "Widget"
                          : tab === "events"
                            ? "Events"
                            : tab === "rules"
                              ? "Rules"
                              : tab === "memory"
                                ? "Memory"
                                : tab === "capture"
                                  ? "Capture"
                                  : "Profiles"}
                      </button>
                    )
                  )}
                </div>
                <div className="panel-scroll">
                  {inspectorTab === "widget" && (
                    <div className="panel-section">
                      <h3>Widget Inspector</h3>
                      {flatWidgets.length === 0 ? (
                        <p className="status-muted">No widgets in the active plan.</p>
                      ) : (
                        <>
                          <div className="widget-list">
                            {flatWidgets.map((widget) => (
                              <button
                                key={widget.id}
                                type="button"
                                className={`widget-item${selectedWidgetId === widget.id ? " selected" : ""}`}
                                onClick={() => setSelectedWidgetId(widget.id)}
                              >
                                <span className="widget-name">
                                  {widget.title ? widget.title : widget.id}
                                </span>
                                <span className="widget-type">{widget.type}</span>
                              </button>
                            ))}
                          </div>
                          {selectedWidget && (
                            <div className="widget-details">
                              <div className="detail-row">
                                <span className="detail-label">Id</span>
                                <span className="detail-value">{selectedWidget.id}</span>
                              </div>
                              <div className="detail-row">
                                <span className="detail-label">Type</span>
                                <span className="detail-value">{selectedWidget.type}</span>
                              </div>
                              {selectedWidget.title && (
                                <div className="detail-row">
                                  <span className="detail-label">Title</span>
                                  <span className="detail-value">{selectedWidget.title}</span>
                                </div>
                              )}
                              {renderWidgetDetails(selectedWidget)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {inspectorTab === "events" && (
                    <div className="panel-section">
                      <h3>Event Log</h3>
                      {eventLogError && <p className="status-error">{eventLogError}</p>}
                      {recentEventEntries.length === 0 ? (
                        <p className="status-muted">No events logged yet.</p>
                      ) : (
                        <ul className="event-feed">
                          {recentEventEntries.map((entry) => {
                            const preview =
                              entry.note ?? entry.data?.text ?? `Event ${entry.eventType}`;
                            return (
                              <li key={entry.id}>
                                <div className="event-time">
                                  {formatCaptureTime(entry.timestamp)}
                                </div>
                                <div className="event-body">
                                  <span className="event-type">{entry.eventType}</span>
                                  <span className="event-note">
                                    {truncateText(preview, 140)}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  {inspectorTab === "rules" && (
                    <div className="rules-panel">
                      <h3>Rules (Passive)</h3>
                      {rulesError && <p className="capture-error">{rulesError}</p>}
                      <div className="rules-form">
                        <select
                          value={ruleMode}
                          onChange={(e) => setRuleMode(e.target.value as Rule["mode"])}
                        >
                          <option value="includes">Includes</option>
                          <option value="regex">Regex</option>
                        </select>
                        <input
                          value={rulePattern}
                          onChange={(e) => setRulePattern(e.target.value)}
                          placeholder={ruleMode === "regex" ? "Pattern (regex)" : "Text to match"}
                        />
                        <select
                          value={ruleActionType}
                          onChange={(e) =>
                            setRuleActionType(e.target.value as Rule["action"]["type"])
                          }
                        >
                          <option value="setTextWidget">Set Text Widget</option>
                          <option value="incrementCounter">Increment Counter</option>
                        </select>
                        <select value={ruleWidgetId} onChange={(e) => setRuleWidgetId(e.target.value)}>
                          <option value="" disabled>
                            Choose widget
                          </option>
                          {(ruleActionType === "setTextWidget" ? textWidgets : counterWidgets).map((widget) => (
                            <option key={widget.id} value={widget.id}>
                              {widget.title ? `${widget.title} (${widget.id})` : widget.id}
                            </option>
                          ))}
                        </select>
                        {ruleActionType === "setTextWidget" ? (
                          <input
                            value={ruleTemplate}
                            onChange={(e) => setRuleTemplate(e.target.value)}
                            placeholder="Template (use ${text}, ${match0}, ${g1}...)"
                          />
                        ) : (
                          <input
                            type="number"
                            value={ruleAmount}
                            onChange={(e) => setRuleAmount(Number(e.target.value))}
                          />
                        )}
                        <button type="button" onClick={handleAddRule}>
                          Add Rule
                        </button>
                      </div>

                      <ul className="rules-list">
                        {rulesStore.rules.map((rule) => (
                          <li key={rule.id}>
                            <label className="rules-toggle">
                              <input
                                type="checkbox"
                                checked={rule.enabled}
                                onChange={() => handleToggleRule(rule.id)}
                              />
                              <span>{rule.id}</span>
                            </label>
                            <span className="rules-desc">
                              {rule.mode}:{rule.pattern} {" -> "} {rule.action.type} ({rule.action.widgetId}
                              {rule.action.type === "trackRate" ? `, ${rule.action.template}` : ""}
                              )
                            </span>
                            <button type="button" onClick={() => handleDeleteRule(rule.id)}>
                              Delete
                            </button>
                          </li>
                        ))}
                        {rulesStore.rules.length === 0 && <li className="rules-empty">No rules yet.</li>}
                      </ul>
                    </div>
                  )}

                  {inspectorTab === "memory" && (
                    <div className="memory-panel">
                      <h3>Memory</h3>
                      {memoryError && <p className="capture-error">{memoryError}</p>}
                      <div className="memory-form">
                        <input
                          value={memoryInput}
                          onChange={(event) => setMemoryInput(event.target.value)}
                          placeholder="Add a note (e.g., boss mechanic, reminder...)"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            handleAddMemoryEntry(memoryInput);
                            setMemoryInput("");
                          }}
                        >
                          Add
                        </button>
                      </div>
                      <ul className="memory-list">
                        {memoryStore.entries.slice(0, 20).map((entry) => (
                          <li key={entry.id}>
                            <span className="memory-time">{formatCaptureTime(entry.createdAt)}</span>
                            <span className="memory-text">{entry.text}</span>
                            <button type="button" onClick={() => handleDeleteMemoryEntry(entry.id)}>
                              Delete
                            </button>
                          </li>
                        ))}
                        {memoryStore.entries.length === 0 && (
                          <li className="memory-empty">No memory entries yet.</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {inspectorTab === "capture" && (
                    <div className="capture-panel">
                      <h3>Capture OCR</h3>
                      <p className="capture-status">{captureStatus}</p>
                      {captureError && <p className="capture-error">{captureError}</p>}
                      <p className="capture-meta">
                        {lastCaptureAt
                          ? `Last capture ${formatCaptureTime(lastCaptureAt)}`
                          : "No captures yet."}
                        {lastOcrConfidence !== null ? ` | Confidence ${lastOcrConfidence}%` : ""}
                      </p>
                      <p className={lastOcrPreview ? "capture-preview" : "capture-preview muted"}>
                        {lastOcrPreview ?? "No OCR text yet."}
                      </p>
                      <p className="capture-meta">
                        ROI: {settings?.captureRoi ? "set" : "not set"}{" "}
                        <button type="button" onClick={() => startRoiSelection().catch(() => undefined)}>
                          Set ROI
                        </button>
                        {settings?.captureRoi && (
                          <button type="button" onClick={() => clearRoi().catch(() => undefined)}>
                            Clear ROI
                          </button>
                        )}
                      </p>
                      <div className="capture-source">
                        <div className="capture-source-header">
                          <span className="capture-source-label">Source</span>
                          <button type="button" onClick={() => loadCaptureSources().catch(() => undefined)}>
                            Refresh
                          </button>
                        </div>
                        <select value={captureSourceValue} onChange={handleCaptureSourceChange}>
                          <option value="" disabled>
                            Choose window or display
                          </option>
                          {displaySources.length > 0 && (
                            <optgroup label="Displays">
                              {displaySources.map((source) => (
                                <option key={`display:${source.id}`} value={`display:${source.id}`}>
                                  {source.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {windowSources.length > 0 && (
                            <optgroup label="Windows">
                              {windowSources.map((source) => (
                                <option key={`window:${source.id}`} value={`window:${source.id}`}>
                                  {source.processName ? `${source.name} (${source.processName})` : source.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {captureSourcesError && <p className="capture-error">{captureSourcesError}</p>}
                      </div>
                    </div>
                  )}

                  {inspectorTab === "profiles" && (
                    <div className="panel-section">
                      <h3>Profiles</h3>
                      <p className="status-muted">
                        Active profile: default. Profile management is coming soon.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </main>

      {roiSnapshot && (
        <div className="roi-modal" role="dialog" aria-modal="true">
          <div className="roi-modal-card">
            <div className="roi-modal-header">
              <strong>Select ROI</strong>
              <button type="button" onClick={closeRoiModal}>
                Close
              </button>
            </div>
            <p className="roi-modal-help">
              Drag on the screenshot to select the region to OCR (best: HUD/text area only).
            </p>
            {roiError && <p className="capture-error">{roiError}</p>}
            <div
              className="roi-canvas"
              onPointerDown={handleRoiPointerDown}
              onPointerMove={handleRoiPointerMove}
              onPointerUp={handleRoiPointerUp}
            >
              <img ref={roiImageRef} src={roiSnapshot.dataUrl} alt="ROI snapshot" />
              {roiDraft && roiDraft.width > 0 && roiDraft.height > 0 && (
                <div
                  className="roi-rect"
                  style={{
                    left: `${roiDraft.x * 100}%`,
                    top: `${roiDraft.y * 100}%`,
                    width: `${roiDraft.width * 100}%`,
                    height: `${roiDraft.height * 100}%`
                  }}
                />
              )}
            </div>
            <div className="roi-modal-actions">
              <button type="button" onClick={() => saveRoi().catch(() => undefined)}>
                Save ROI
              </button>
              <button type="button" onClick={() => clearRoi().catch(() => undefined)}>
                Clear ROI
              </button>
              <button type="button" onClick={closeRoiModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
