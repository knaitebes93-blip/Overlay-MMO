import { z } from "zod";
import { overlayPlanSchema } from "./planSchema";

const memoryEntryBaseSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  createdAt: z.number().nonnegative(),
  source: z.enum(["user", "system", "ocr", "import"]),
  tags: z.array(z.string()).optional()
});

const planSnapshotPayloadSchema = z.object({
  snapshotId: z.string().min(1),
  planJson: overlayPlanSchema,
  reason: z.string().min(1),
  actor: z.enum(["user", "rules"]),
  baseSnapshotId: z.string().optional()
});

const notePayloadSchema = z.object({
  text: z.string().min(1)
});

const genericPayloadSchema = z.record(z.unknown());

const planSnapshotEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("plan_snapshot"),
  payload: planSnapshotPayloadSchema
});

const noteEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("note"),
  payload: notePayloadSchema
});

const ruleEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("rule"),
  payload: genericPayloadSchema
});

const ruleEventEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("rule_event"),
  payload: genericPayloadSchema
});

const captureMetaEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("capture_meta"),
  payload: genericPayloadSchema
});

const ocrEventEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("ocr_event"),
  payload: genericPayloadSchema
});

const manualEventEntrySchema = memoryEntryBaseSchema.extend({
  type: z.literal("manual_event"),
  payload: genericPayloadSchema
});

export const memoryEntrySchema = z.discriminatedUnion("type", [
  planSnapshotEntrySchema,
  noteEntrySchema,
  ruleEntrySchema,
  ruleEventEntrySchema,
  captureMetaEntrySchema,
  ocrEventEntrySchema,
  manualEventEntrySchema
]);

export const memoryStoreSchema = z.object({
  version: z.literal("1.0"),
  entries: z.array(memoryEntrySchema)
});

export type MemoryStoreSchema = z.infer<typeof memoryStoreSchema>;
