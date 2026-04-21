import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { collectGpuMetrics, HostMetricsCollectorError } from "./collector/nvidia-smi.js";
import { loadConfig, type HostMetricsServerConfig } from "./config.js";
import type { HostGpuErrorResponse, HostGpuMetrics } from "./types.js";

type CreateAppOptions = {
  config?: HostMetricsServerConfig;
  collector?: () => Promise<HostGpuMetrics>;
  now?: () => Date;
};

function toUnavailable(reason: string, now: Date): HostGpuErrorResponse {
  return {
    status: "unavailable",
    sampledAt: now.toISOString(),
    reason
  };
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const now = options.now ?? (() => new Date());
  const collector =
    options.collector ??
    (() =>
      collectGpuMetrics({
        gpuIndex: config.gpuIndex,
        timeoutMs: config.commandTimeoutMs
      }));

  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "host-metrics-server",
    version: "0.1.0"
  }));

  app.get("/version", async () => ({
    service: "host-metrics-server",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/gpu", async (_, reply) => {
    try {
      return await collector();
    } catch (error) {
      const collectorError =
        error instanceof HostMetricsCollectorError
          ? error
          : new HostMetricsCollectorError("collector_failed", "Failed to collect GPU metrics");

      reply.code(503);
      return toUnavailable(collectorError.reason, now());
    }
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const app = createApp({ config });
  void app.listen({ host: "0.0.0.0", port: config.port });
}
