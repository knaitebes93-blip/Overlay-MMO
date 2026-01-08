import { overlayPlanSchema } from "../shared/planSchema";
import { WidgetSpec, WidgetSpecWidget } from "./widgetSpec";

export type LegacyPlanMigrationResult =
  | { ok: true; value: WidgetSpec; warnings: string[] }
  | { ok: false; error: string };

const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      Object.keys(record)
        .sort()
        .forEach((key) => {
          sorted[key] = normalize(record[key]);
        });
      return sorted;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
};

const fnv1aHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const layoutForType = (type: string) => {
  switch (type) {
    case "timer":
      return { w: 260, h: 120 };
    case "tracker":
      return { w: 280, h: 140 };
    case "roi_panel":
      return { w: 320, h: 160 };
    case "table":
      return { w: 420, h: 220 };
    default:
      return { w: 320, h: 160 };
  }
};

const buildNotesWidget = (
  id: string,
  title: string | undefined,
  text: string,
  layout: { x: number; y: number; w: number; h: number },
  legacyPayload?: unknown
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
    layout,
    legacyPayload
  }
});

const convertLegacyWidget = (
  widget: Record<string, unknown>,
  indexPath: string,
  layout: { x: number; y: number; w: number; h: number },
  warnings: string[]
): WidgetSpecWidget => {
  const type = typeof widget.type === "string" ? widget.type : "unknown";
  const title = typeof widget.title === "string" ? widget.title : undefined;
  const content = stableStringify(widget);
  const hashInput = `${type}|${indexPath}|${content}`;
  const idPrefix = type === "text" ? "notes" : type;
  const id = `${idPrefix}_${fnv1aHash(hashInput)}`;

  if (type === "text") {
    const text = typeof widget.text === "string" ? widget.text : "(empty)";
    return buildNotesWidget(id, title, text, layout, widget);
  }

  const knownTypes = new Set([
    "counter",
    "timer",
    "checklist",
    "panel",
    "eventLog",
    "rate",
    "projection"
  ]);

  if (!knownTypes.has(type)) {
    warnings.push(`Unsupported legacy widget "${type}" migrated to notes.`);
    const text = `Unsupported legacy widget "${type}". Payload: ${content}`;
    return buildNotesWidget(id, title, text, layout, widget);
  }

  const next: WidgetSpecWidget = {
    ...(widget as WidgetSpecWidget),
    id,
    type,
    title,
    data: {
      ...(typeof (widget as WidgetSpecWidget).data === "object"
        ? (widget as WidgetSpecWidget).data
        : {}),
      layout,
      legacyPayload: widget
    }
  };

  if (type === "panel" && Array.isArray((widget as { children?: unknown }).children)) {
    const children = (widget as { children: Array<Record<string, unknown>> }).children;
    next.children = children.map((child, index) =>
      convertLegacyWidget(
        child,
        `${indexPath}.${index}`,
        { x: 0, y: 0, ...layoutForType(child.type as string) },
        warnings
      )
    );
  }

  return next;
};

export const migrateLegacyPlan = (
  payload: unknown,
  profileId = "default"
): LegacyPlanMigrationResult => {
  const parsed = overlayPlanSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Payload does not match legacy overlay plan format." };
  }

  const warnings: string[] = [];
  const widgets = parsed.data.widgets.map((widget, index) => {
    const layoutBase = layoutForType(widget.type);
    const layout = {
      x: 24,
      y: index * (layoutBase.h + 16),
      ...layoutBase
    };
    return convertLegacyWidget(widget as Record<string, unknown>, `${index}`, layout, warnings);
  });

  return {
    ok: true,
    value: {
      version: "1.0",
      profileId,
      widgets
    },
    warnings
  };
};
