import { z } from "zod";
import { isoDateSchema } from "./common.js";

export const modelSchema = z.object({
  name: z.string(),
  size: z.number().nonnegative(),
  modifiedAt: isoDateSchema
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
