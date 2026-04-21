import { z } from "zod";
import { isoDateSchema } from "./common.js";

export const ollamaRuntimeSchema = z.object({
  busy: z.boolean(),
  activeRequests: z.number().int().nonnegative(),
  maxParallelRequests: z.number().int().positive(),
  queueDepth: z.number().int().nonnegative(),
  residentModels: z.array(z.string()),
  fastPathModels: z.array(z.string()),
  fetchedAt: isoDateSchema
});
