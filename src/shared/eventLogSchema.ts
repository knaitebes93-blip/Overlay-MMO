import { z } from "zod";

export const eventLogEntrySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  timestamp: z.number().nonnegative(),
  note: z.string().optional(),
  data: z
    .object({
      text: z.string().optional(),
      confidence: z.number().nullable().optional(),
      capturePath: z.string().optional(),
      sourceName: z.string().optional(),
      capturedAt: z.number().nonnegative().optional()
    })
    .optional()
});

export const eventLogSchema = z.object({
  version: z.literal("1.0"),
  entries: z.array(eventLogEntrySchema)
});

export type EventLogSchema = z.infer<typeof eventLogSchema>;
