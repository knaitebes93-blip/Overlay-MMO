import {
  OverlayAPI,
  OverlayPlan,
  OverlayWidget,
  PlanSaveMeta
} from "../shared/ipc";
import { validateWidgetSpec, WidgetSpec, WidgetSpecWidget } from "../widgetSpec";

export type PlanStoreState = {
  currentPlan: WidgetSpec;
  lastKnownGoodPlan: WidgetSpec;
  loadStatus: "idle" | "loading" | "ready" | "error";
  error?: string;
  warning?: string;
};

const overlayWidgetTypes = new Set([
  "text",
  "counter",
  "timer",
  "checklist",
  "panel",
  "eventLog",
  "rate",
  "projection"
]);

const buildNotesWidgetSpec = (
  id: string,
  title: string | undefined,
  text: string
): WidgetSpecWidget => ({
  id,
  type: "notes",
  title: title ?? "Notes",
  data: {
    requiredFields: [
      {
        key: "text",
        label: "Text",
        type: "string",
        question: "Notes text?"
      }
    ],
    values: { text },
    outputs: [{ label: "Text", valueKey: "text" }],
    layout: { w: 320, h: 160 }
  }
});

export const buildFallbackWidgetSpec = (
  profileId: string,
  message: string
): WidgetSpec => ({
  version: "1.0",
  profileId,
  widgets: [buildNotesWidgetSpec("notes_fallback", "Plan Reset", message)]
});

export const overlayPlanToWidgetSpec = (
  plan: OverlayPlan,
  profileId: string
): WidgetSpec => {
  const convertWidget = (widget: OverlayWidget): WidgetSpecWidget => {
    if (widget.type === "text") {
      return buildNotesWidgetSpec(widget.id, widget.title, widget.text);
    }
    if (widget.type === "panel") {
      const children = widget.children.map(convertWidget);
      return { ...widget, children } as WidgetSpecWidget;
    }
    return { ...widget } as WidgetSpecWidget;
  };
  return {
    version: "1.0",
    profileId,
    widgets: plan.widgets.map(convertWidget)
  };
};

const getValue = (
  widget: WidgetSpecWidget,
  key: string
): string | number | undefined => {
  const values = widget.data?.values as Record<string, unknown> | undefined;
  const value = values?.[key];
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
};

const summaryForWidget = (widget: WidgetSpecWidget): string => {
  switch (widget.type) {
    case "tracker": {
      const metric = getValue(widget, "metric_name") ?? "Metric";
      const start = getValue(widget, "start_value") ?? "?";
      const end = getValue(widget, "end_value") ?? "?";
      const duration = getValue(widget, "duration_minutes") ?? "?";
      return `Tracker ${metric}: start=${start} end=${end} duration=${duration} min`;
    }
    case "roi_panel": {
      const cost = getValue(widget, "cost") ?? "?";
      const revenue = getValue(widget, "revenue") ?? "?";
      const feePercent = getValue(widget, "fee_percent") ?? "?";
      const feeFixed = getValue(widget, "fee_fixed") ?? 0;
      return `ROI: cost=${cost} revenue=${revenue} fee=${feePercent}% fixed=${feeFixed}`;
    }
    case "table": {
      const columns = getValue(widget, "columns") ?? "";
      return `Table columns: ${columns || "?"}`;
    }
    default:
      return `Widget ${widget.type}`;
  }
};

export const widgetSpecToOverlayPlan = (spec: WidgetSpec): OverlayPlan => {
  const convertWidget = (widget: WidgetSpecWidget): OverlayWidget => {
    if (widget.type === "notes") {
      const text =
        (getValue(widget, "text") as string | number | undefined)?.toString() ??
        "";
      return {
        id: widget.id,
        type: "text",
        title: widget.title ?? "Notes",
        text
      };
    }
    if (widget.type === "timer") {
      const record = widget as Record<string, unknown>;
      const secondsValue = record.seconds;
      const seconds =
        typeof secondsValue === "number"
          ? secondsValue
          : Number(getValue(widget, "duration") ?? 0);
      const title =
        (getValue(widget, "name") as string | undefined) ??
        widget.title ??
        "Timer";
      const runningValue = record.running;
      const running = typeof runningValue === "boolean" ? runningValue : false;
      return {
        id: widget.id,
        type: "timer",
        title,
        seconds: Number.isFinite(seconds) ? seconds : 0,
        running
      };
    }
    if (widget.type === "panel") {
      const childrenValue = (widget as Record<string, unknown>).children;
      const children = Array.isArray(childrenValue)
        ? (childrenValue as WidgetSpecWidget[]).map(convertWidget)
        : [];
      return {
        id: widget.id,
        type: "panel",
        title: widget.title,
        children
      };
    }
    if (overlayWidgetTypes.has(widget.type)) {
      return widget as OverlayWidget;
    }
    return {
      id: widget.id,
      type: "text",
      title: widget.title ?? widget.type,
      text: summaryForWidget(widget)
    };
  };
  return {
    version: "1.0",
    widgets: spec.widgets.map(convertWidget)
  };
};

export const applyPlan = async (
  overlayAPI: OverlayAPI | undefined,
  nextPlan: WidgetSpec,
  meta: PlanSaveMeta
): Promise<{ ok: true; plan: WidgetSpec } | { ok: false; error: string }> => {
  const validation = validateWidgetSpec(nextPlan);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  if (!overlayAPI || typeof overlayAPI.savePlan !== "function") {
    return { ok: false, error: "Plan API not available. Restart Electron." };
  }
  try {
    const saved = await overlayAPI.savePlan(validation.value, meta);
    return { ok: true, plan: saved };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to apply plan."
    };
  }
};
