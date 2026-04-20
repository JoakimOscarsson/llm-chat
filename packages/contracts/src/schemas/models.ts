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

