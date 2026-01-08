import { z } from "zod";

const baseWidget = z.object({
  id: z.string(),
  title: z.string().optional()
});

export const widgetSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("type", [
    textWidgetSchema,
    counterWidgetSchema,
    timerWidgetSchema,
    checklistWidgetSchema,
    panelWidgetSchema,
    eventLogWidgetSchema,
    rateWidgetSchema,
    projectionWidgetSchema
  ])
);

export const textWidgetSchema = baseWidget.extend({
  type: z.literal("text"),
  text: z.string()
});

export const counterWidgetSchema = baseWidget.extend({
  type: z.literal("counter"),
  value: z.number(),
  step: z.number().min(1)
});

export const timerWidgetSchema = baseWidget.extend({
  type: z.literal("timer"),
  seconds: z.number().min(0),
  running: z.boolean()
});

export const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean()
});

export const checklistWidgetSchema = baseWidget.extend({
  type: z.literal("checklist"),
  items: z.array(checklistItemSchema)
});

export const panelWidgetSchema = baseWidget.extend({
  type: z.literal("panel"),
  children: z.array(widgetSchema)
});

export const eventLogWidgetSchema = baseWidget.extend({
  type: z.literal("eventLog"),
  eventType: z.string(),
  showLast: z.number().int().min(1)
});

export const rateWidgetSchema = baseWidget.extend({
  type: z.literal("rate"),
  eventType: z.string(),
  lookbackMinutes: z.number().int().min(1)
});

export const projectionWidgetSchema = baseWidget.extend({
  type: z.literal("projection"),
  eventType: z.string(),
  lookbackMinutes: z.number().int().min(1),
  horizonMinutes: z.number().int().min(1)
});

export const overlayPlanSchema = z.object({
  version: z.literal("1.0"),
  widgets: z.array(widgetSchema)
});

export type OverlayPlanSchema = z.infer<typeof overlayPlanSchema>;
