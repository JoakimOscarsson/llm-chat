import { z } from "zod";

const generationOptionsSchema = z.object({
  temperature: z.number(),
  top_k: z.number().int(),
  top_p: z.number(),
  repeat_penalty: z.number(),
  seed: z.number().int().optional(),
  num_ctx: z.number().int().positive(),
  num_predict: z.number().int().positive(),
  stop: z.array(z.string()),
  keep_alive: z.union([z.string(), z.number()]).optional()
});

export const appDefaultsSchema = z.object({
  systemPrompt: z.string(),
  requestHistoryCount: z.number().int().nonnegative(),
  responseHistoryCount: z.number().int().nonnegative(),
  streamThinking: z.boolean(),
  persistSessions: z.boolean(),
  options: generationOptionsSchema
});

export const appDefaultsResponseSchema = z.object({
  defaults: appDefaultsSchema
});
