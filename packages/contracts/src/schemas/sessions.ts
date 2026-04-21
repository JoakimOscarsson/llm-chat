import { z } from "zod";
import { isoDateSchema } from "./common.js";
import { appDefaultsSchema } from "./settings.js";

const thinkingTraceSchema = z.object({
  content: z.string(),
  collapsedByDefault: z.literal(true)
});

const chatContentMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  createdAt: isoDateSchema,
  thinking: thinkingTraceSchema.optional(),
  kind: z.literal("message").optional()
});

const modelSwitchMarkerSchema = z.object({
  id: z.string(),
  role: z.literal("system"),
  content: z.string(),
  createdAt: isoDateSchema,
  kind: z.literal("model_switch"),
  model: z.string().min(1)
});

export const chatMessageSchema = z.union([chatContentMessageSchema, modelSwitchMarkerSchema]);

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

export const sessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema)
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

export const sessionResponseSchema = z.object({
  session: sessionSchema
});

export const createSessionRequestSchema = z.object({
  title: z.string().min(1).default("New chat"),
  model: z.string().min(1)
});

export const messagePersistRequestSchema = z.object({
  message: chatMessageSchema
});

export const assistantResultPersistRequestSchema = z.object({
  message: chatMessageSchema,
  thinking: thinkingTraceSchema.optional()
});

export const sessionContextResponseSchema = z.object({
  sessionId: z.string(),
  model: z.string(),
  globalDefaults: appDefaultsSchema,
  overrides: sessionOverridesSchema.default({}),
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string()
    })
  )
});

export const sessionPatchSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  overrides: sessionOverridesSchema.optional()
});

export const modelSwitchPersistRequestSchema = z.object({
  model: z.string().min(1),
  createdAt: isoDateSchema.optional()
});
