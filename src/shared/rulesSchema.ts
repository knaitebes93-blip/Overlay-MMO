import { z } from "zod";

export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setTextWidget"),
    widgetId: z.string().min(1),
    template: z.string().min(1)
  }),
  z.object({
    type: z.literal("incrementCounter"),
    widgetId: z.string().min(1),
    amount: z.number().int()
  }),
  z.object({
    type: z.literal("trackRate"),
    widgetId: z.string().min(1),
    template: z.string().min(1),
    valueSource: z.enum(["match0", "g1"]).optional(),
    unit: z.string().optional(),
    precision: z.number().int().min(0).max(6).optional(),
    minSeconds: z.number().int().min(1).optional()
  })
]);

export const ruleSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  mode: z.union([z.literal("includes"), z.literal("regex")]),
  pattern: z.string().min(1),
  action: ruleActionSchema,
  state: z
    .object({
      lastValue: z.number().optional(),
      lastAt: z.number().nonnegative().optional()
    })
    .optional()
});

export const rulesStoreSchema = z.object({
  version: z.literal("1.0"),
  rules: z.array(ruleSchema)
});

export type RulesStoreSchema = z.infer<typeof rulesStoreSchema>;
