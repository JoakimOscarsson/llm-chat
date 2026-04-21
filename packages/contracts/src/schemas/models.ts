import { z } from "zod";
import { isoDateSchema } from "./common.js";

export const modelSchema = z.object({
  name: z.string(),
  size: z.number().nonnegative(),
  modifiedAt: isoDateSchema,
  chatCapable: z.boolean().default(true),
  capabilitySource: z.enum(["stub", "show", "tags", "unknown"]).default("unknown"),
  capabilities: z.array(z.string()).default([]),
  exclusionReason: z.enum(["embedding", "missing_capability_metadata", "non_chat_capability"]).optional(),
  family: z.string().optional(),
  families: z.array(z.string()).default([])
});

export const modelsResponseSchema = z.object({
  models: z.array(modelSchema),
  fetchedAt: isoDateSchema
});

export const modelWarmRequestSchema = z.object({
  model: z.string().min(1),
  keep_alive: z.union([z.string(), z.number()]).optional()
});

export const modelWarmResponseSchema = z.object({
  ready: z.literal(true),
  model: z.string(),
  warmedAt: isoDateSchema,
  loadDuration: z.number().nonnegative().optional(),
  totalDuration: z.number().nonnegative().optional()
});
