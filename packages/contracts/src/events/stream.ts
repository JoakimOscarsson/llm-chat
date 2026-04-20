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
      code: z.string(),
      message: z.string(),
      requestId: z.string()
    })
  })
]);

