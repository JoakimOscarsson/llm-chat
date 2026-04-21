import { z } from "zod";

export const streamEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("meta"),
    data: z.object({
      requestId: z.string(),
      sessionId: z.string().optional(),
      model: z.string()
    })
  }),
  z.object({
    event: z.literal("queued"),
    data: z.object({
      requestId: z.string(),
      position: z.number().int().positive(),
      queueDepth: z.number().int().nonnegative(),
      model: z.string(),
      promptAfterMs: z.number().int().nonnegative()
    })
  }),
  z.object({
    event: z.literal("queue_update"),
    data: z.object({
      requestId: z.string(),
      position: z.number().int().positive(),
      queueDepth: z.number().int().nonnegative()
    })
  }),
  z.object({
    event: z.literal("queue_prompt"),
    data: z.object({
      requestId: z.string(),
      position: z.number().int().positive(),
      waitedMs: z.number().int().nonnegative()
    })
  }),
  z.object({
    event: z.literal("started"),
    data: z.object({
      requestId: z.string(),
      model: z.string(),
      startedAt: z.string()
    })
  }),
  z.object({
    event: z.literal("session_title"),
    data: z.object({
      sessionId: z.string(),
      title: z.string()
    })
  }),
  z.object({
    event: z.literal("thinking_unavailable"),
    data: z.object({
      requestId: z.string().optional(),
      model: z.string().optional(),
      attempt: z.number().int().positive().optional(),
      text: z.string()
    })
  }),
  z.object({
    event: z.literal("thinking_delta"),
    data: z.object({
      text: z.string()
    })
  }),
  z.object({
    event: z.literal("response_delta"),
    data: z.object({
      text: z.string()
    })
  }),
  z.object({
    event: z.literal("settings_notice"),
    data: z.object({
      text: z.string(),
      option: z.string().optional(),
      attempt: z.number().int().positive().optional(),
      requestId: z.string().optional()
    })
  }),
  z.object({
    event: z.literal("usage"),
    data: z.record(z.string(), z.number())
  }),
  z.object({
    event: z.literal("done"),
    data: z.object({
      finishReason: z.string()
    })
  }),
  z.object({
    event: z.literal("error"),
    data: z.object({
      code: z.string().optional(),
      message: z.string(),
      requestId: z.string(),
      model: z.string().optional(),
      status: z.number().optional()
    })
  })
]);
