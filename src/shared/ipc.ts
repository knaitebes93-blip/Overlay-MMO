export type OverlaySettings = {
  bounds: { x: number; y: number; width: number; height: number } | null;
  displayId: number | null;
  opacity: number;
  clickThrough: boolean;
  captureEnabled: boolean;
  captureSourceType: CaptureSourceType | null;
  captureSourceId: string | null;
  captureRoi: CaptureRoi | null;
  llm: LlmSettings;
};

export type DisplayInfo = {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
};

export type OverlayPlan = {
  version: "1.0";
  widgets: OverlayWidget[];
};

export type MemoryEntry = {
  id: string;
  createdAt: number;
  text: string;
  tags?: string[];
};

export type MemoryStore = {
  version: "1.0";
  entries: MemoryEntry[];
};

export type RuleAction =
  | {
      type: "setTextWidget";
      widgetId: string;
      template: string;
    }
  | {
      type: "incrementCounter";
      widgetId: string;
      amount: number;
    }
  | {
      type: "trackRate";
      widgetId: string;
      template: string;
      valueSource?: "match0" | "g1";
      unit?: string;
      precision?: number;
      minSeconds?: number;
    };

export type Rule = {
  id: string;
  enabled: boolean;
  mode: "includes" | "regex";
  pattern: string;
  action: RuleAction;
  state?: {
    lastValue?: number;
    lastAt?: number;
  };
};

export type RulesStore = {
  version: "1.0";
  rules: Rule[];
};

export type LlmProvider =
  | "openai"
  | "groq"
  | "openrouter"
  | "mistral"
  | "ollama"
  | "lmstudio"
  | "custom";

export type LlmSettings = {
  enabled: boolean;
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type PlannerComposeInput = {
  message: string;
  plan: OverlayPlan;
  rules: RulesStore;
};

export type PlannerComposeResult = {
  plan: OverlayPlan;
  rules: RulesStore;
  note: string;
};

export type EventLogEntry = {
  id: string;
  eventType: string;
  timestamp: number;
  note?: string;
  data?: EventLogEntryData;
};

export type EventLog = {
  version: "1.0";
  entries: EventLogEntry[];
};

export type EventLogEntryData = {
  text?: string;
  confidence?: number | null;
  capturePath?: string;
  sourceName?: string;
  capturedAt?: number;
};

export type OcrResult = {
  text: string;
  confidence: number | null;
  capturePath: string;
  sourceName: string;
  capturedAt: number;
  error?: string;
};

export type CaptureSourceType = "display" | "window";

export type CaptureSource = {
  id: string;
  name: string;
  type: CaptureSourceType;
  processName?: string;
};

export type CaptureTarget = {
  id: string;
  type: CaptureSourceType;
};

export type CaptureRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CaptureSnapshotResult = {
  capturePath: string;
  sourceName: string;
  capturedAt: number;
  width: number;
  height: number;
  dataUrl: string;
};

export type PlanLoadResult = {
  plan: OverlayPlan | null;
  warning?: string;
};

export type OverlayWidget =
  | TextWidget
  | CounterWidget
  | TimerWidget
  | ChecklistWidget
  | PanelWidget
  | EventLogWidget
  | RateWidget
  | ProjectionWidget;

export type BaseWidget = {
  id: string;
  title?: string;
};

export type TextWidget = BaseWidget & {
  type: "text";
  text: string;
};

export type CounterWidget = BaseWidget & {
  type: "counter";
  value: number;
  step: number;
};

export type TimerWidget = BaseWidget & {
  type: "timer";
  seconds: number;
  running: boolean;
};

export type ChecklistItem = {
  id: string;
  text: string;
  checked: boolean;
};

export type ChecklistWidget = BaseWidget & {
  type: "checklist";
  items: ChecklistItem[];
};

export type PanelWidget = BaseWidget & {
  type: "panel";
  children: OverlayWidget[];
};

export type EventLogWidget = BaseWidget & {
  type: "eventLog";
  eventType: string;
  showLast: number;
};

export type RateWidget = BaseWidget & {
  type: "rate";
  eventType: string;
  lookbackMinutes: number;
};

export type ProjectionWidget = BaseWidget & {
  type: "projection";
  eventType: string;
  lookbackMinutes: number;
  horizonMinutes: number;
};

export type PlannerResult = {
  plan: OverlayPlan;
  note: string;
};

export type OverlayAPI = {
  getSettings: () => Promise<OverlaySettings>;
  saveSettings: (settings: OverlaySettings) => Promise<void>;
  getDisplays: () => Promise<DisplayInfo[]>;
  setDisplay: (displayId: number) => Promise<void>;
  loadPlan: () => Promise<PlanLoadResult>;
  savePlan: (plan: OverlayPlan) => Promise<void>;
  undoPlan: () => Promise<OverlayPlan>;
  redoPlan: () => Promise<OverlayPlan>;
  composePlan: (input: PlannerComposeInput) => Promise<PlannerComposeResult>;
  loadEventLog: () => Promise<EventLog>;
  saveEventLog: (log: EventLog) => Promise<void>;
  loadMemory: () => Promise<MemoryStore>;
  saveMemory: (store: MemoryStore) => Promise<void>;
  loadRules: () => Promise<RulesStore>;
  saveRules: (store: RulesStore) => Promise<void>;
  listCaptureSources: () => Promise<CaptureSource[]>;
  captureAndProcess: (target: CaptureTarget | null) => Promise<OcrResult | null>;
  captureSnapshot: (target: CaptureTarget) => Promise<CaptureSnapshotResult>;
  stopCapture: () => void;
  onEscapeHatch: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    overlayAPI: OverlayAPI;
  }
}
