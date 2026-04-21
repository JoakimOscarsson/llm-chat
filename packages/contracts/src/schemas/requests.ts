import { z } from "zod";
import { isoDateSchema } from "./common.js";

export const queuedChatRequestStateSchema = z.enum(["queued", "running", "completed", "cancelled", "failed"]);

export const queuedChatRequestSchema = z.object({
  requestId: z.string(),
  state: queuedChatRequestStateSchema,
  model: z.string().min(1),
  position: z.number().int().positive().optional(),
  queueDepth: z.number().int().nonnegative().optional(),
  queuedAt: isoDateSchema.optional(),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional()
});

export const queuedChatRequestResponseSchema = z.object({
  request: queuedChatRequestSchema
});

export const queuedChatRequestPatchSchema = z
  .object({
    model: z.string().min(1).optional()
  })
  .refine((payload) => payload.model !== undefined, {
    message: "At least one queued request field must be updated."
  });
