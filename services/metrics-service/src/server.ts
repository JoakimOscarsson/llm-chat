import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { gpuMetricsResponseSchema } from "@llm-chat-app/contracts";

export type MetricsServiceConfig = {
  port: number;
  metricsBaseUrl: string;
  metricsTimeoutMs: number;
  metricsStaleAfterMs: number;
};

type CreateAppOptions = {
  config?: MetricsServiceConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type NormalizedSample = {
  sampledAt: string;
  gpu: {
    index?: number;
    name?: string;
    usedMb: number;
    totalMb: number;
    utilizationPct: number;
    temperatureC?: number;
    powerDrawW?: number;
    powerLimitW?: number;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MetricsServiceConfig {
  return {
    port: Number(env.PORT ?? 4004),
    metricsBaseUrl: env.METRICS_BASE_URL ?? "",
    metricsTimeoutMs: Number(env.METRICS_TIMEOUT_MS ?? 1500),
    metricsStaleAfterMs: Number(env.METRICS_STALE_AFTER_MS ?? 30_000)
  };
}

function unavailable(reason: string, now: Date) {
  return gpuMetricsResponseSchema.parse({
    status: "unavailable",
    sampledAt: now.toISOString(),
    reason
  });
}

function normalizePayload(payload: unknown): NormalizedSample | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as {
    sampledAt?: string;
    gpu?: {
      index?: number;
      name?: string;
      usedMb?: number;
      totalMb?: number;
      utilizationPct?: number;
      temperatureC?: number;
      powerDrawW?: number;
      powerLimitW?: number;
    };
    usedMb?: number;
    totalMb?: number;
    utilizationPct?: number;
  };

  const sampledAt = candidate.sampledAt ?? new Date().toISOString();
  const usedMb = candidate.gpu?.usedMb ?? candidate.usedMb;
  const totalMb = candidate.gpu?.totalMb ?? candidate.totalMb;

  if (typeof usedMb !== "number" || typeof totalMb !== "number" || totalMb <= 0) {
    return null;
  }

  const utilizationPct =
    typeof candidate.gpu?.utilizationPct === "number"
      ? candidate.gpu.utilizationPct
      : typeof candidate.utilizationPct === "number"
        ? candidate.utilizationPct
        : (usedMb / totalMb) * 100;

  return {
    sampledAt,
    gpu: {
      index: typeof candidate.gpu?.index === "number" ? candidate.gpu.index : undefined,
      name: typeof candidate.gpu?.name === "string" ? candidate.gpu.name : undefined,
      usedMb,
      totalMb,
      utilizationPct,
      temperatureC:
        typeof candidate.gpu?.temperatureC === "number" ? candidate.gpu.temperatureC : undefined,
      powerDrawW:
        typeof candidate.gpu?.powerDrawW === "number" ? candidate.gpu.powerDrawW : undefined,
      powerLimitW:
        typeof candidate.gpu?.powerLimitW === "number" ? candidate.gpu.powerLimitW : undefined
    }
  };
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "metrics-service",
    version: "0.1.0"
  }));

  app.get("/version", async () => ({
    service: "metrics-service",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/internal/metrics/gpu", async () => {
    const startedAt = now();

    if (!config.metricsBaseUrl.trim()) {
      return unavailable("not_configured", startedAt);
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.metricsTimeoutMs);

    try {
      const response = await fetchImpl(`${config.metricsBaseUrl}/gpu`, {
        signal: abortController.signal
      });
      const payload = (await response.json()) as unknown;
      const normalized = normalizePayload(payload);

      if (!normalized) {
        return unavailable("invalid_payload", now());
      }

      const sampleAgeMs = now().getTime() - new Date(normalized.sampledAt).getTime();

      if (sampleAgeMs > config.metricsStaleAfterMs) {
        return gpuMetricsResponseSchema.parse({
          status: "stale",
          sampledAt: normalized.sampledAt,
          reason: "stale_sample",
          gpu: normalized.gpu
        });
      }

      return gpuMetricsResponseSchema.parse({
        status: "ok",
        sampledAt: normalized.sampledAt,
        gpu: normalized.gpu
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return unavailable("timeout", now());
      }

      return unavailable("upstream_error", now());
    } finally {
      clearTimeout(timeout);
    }
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  void app.listen({ host: "0.0.0.0", port: config.port });
}
