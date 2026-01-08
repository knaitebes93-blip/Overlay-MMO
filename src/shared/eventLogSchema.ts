import { z } from "zod";

export const eventLogEntrySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  timestamp: z.number().nonnegative(),
  note: z.string().optional()
});

export const eventLogSchema = z.object({
  version: z.literal("1.0"),
  entries: z.array(eventLogEntrySchema)
});

export type EventLogSchema = z.infer<typeof eventLogSchema>;
