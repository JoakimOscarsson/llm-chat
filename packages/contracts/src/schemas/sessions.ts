import { z } from "zod";
import { isoDateSchema } from "./common.js";

const thinkingTraceSchema = z.object({
  content: z.string(),
  collapsedByDefault: z.literal(true)
});

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  createdAt: isoDateSchema,
  thinking: thinkingTraceSchema.optional()
});

export const sessionOverridesSchema = z.object({
  systemPrompt: z.string().optional(),
  requestHistoryCount: z.number().int().nonnegative().optional(),
  responseHistoryCount: z.number().int().nonnegative().optional(),
  temperature: z.number().optional(),
  top_k: z.number().int().optional(),
  top_p: z.number().optional(),
  repeat_penalty: z.number().optional(),
  seed: z.number().int().optional(),
  num_ctx: z.number().int().positive().optional(),
  num_predict: z.number().int().positive().optional(),
  stop: z.array(z.string()).optional(),
  keep_alive: z.union([z.string(), z.number()]).optional()
});

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  updatedAt: isoDateSchema
});

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  messages: z.array(chatMessageSchema).default([]),
  overrides: sessionOverridesSchema.optional()
});

