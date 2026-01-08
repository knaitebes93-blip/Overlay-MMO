import { z } from "zod";

export const memoryEntrySchema = z.object({
  id: z.string(),
  createdAt: z.number().nonnegative(),
  text: z.string().min(1),
  tags: z.array(z.string()).optional()
});

export const memoryStoreSchema = z.object({
  version: z.literal("1.0"),
  entries: z.array(memoryEntrySchema)
});

export type MemoryStoreSchema = z.infer<typeof memoryStoreSchema>;

