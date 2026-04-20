import { z } from "zod";

export const isoDateSchema = z.string().datetime();

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string()
  })
});

