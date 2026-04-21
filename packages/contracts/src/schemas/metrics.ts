import { z } from "zod";
import { isoDateSchema } from "./common.js";

export const gpuMetricsSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  name: z.string().min(1).optional(),
  usedMb: z.number().nonnegative(),
  totalMb: z.number().positive(),
  utilizationPct: z.number().min(0).max(100),
  temperatureC: z.number().optional(),
  powerDrawW: z.number().optional(),
  powerLimitW: z.number().optional()
});

export const gpuMetricsResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    sampledAt: isoDateSchema,
    gpu: gpuMetricsSchema
  }),
  z.object({
    status: z.literal("stale"),
    sampledAt: isoDateSchema,
    gpu: gpuMetricsSchema,
    reason: z.string()
  }),
  z.object({
    status: z.literal("unavailable"),
    sampledAt: isoDateSchema,
    reason: z.string()
  })
]);
