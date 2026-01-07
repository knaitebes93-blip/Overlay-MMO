import { z } from "zod";

const baseWidget = z.object({
  id: z.string(),
  title: z.string().optional()
});

let widgetSchema: z.ZodTypeAny;

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
  children: z.array(z.lazy(() => widgetSchema))
});

widgetSchema = z.discriminatedUnion("type", [
  textWidgetSchema,
  counterWidgetSchema,
  timerWidgetSchema,
  checklistWidgetSchema,
  panelWidgetSchema
]);

export { widgetSchema };

export const overlayPlanSchema = z.object({
  version: z.literal("1.0"),
  widgets: z.array(widgetSchema)
});

export type OverlayPlanSchema = z.infer<typeof overlayPlanSchema>;
