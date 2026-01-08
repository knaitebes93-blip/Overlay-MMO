export type OverlaySettings = {
  bounds: { x: number; y: number; width: number; height: number } | null;
  displayId: number | null;
  opacity: number;
  clickThrough: boolean;
  captureEnabled: boolean;
  captureSourceType: CaptureSourceType | null;
  captureSourceId: string | null;
  captureRoi: CaptureRoi | null;
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
  loadEventLog: () => Promise<EventLog>;
  saveEventLog: (log: EventLog) => Promise<void>;
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
