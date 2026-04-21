import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { modelWarmRequestSchema, modelWarmResponseSchema, modelsResponseSchema } from "@llm-chat-app/contracts";

export type ModelServiceConfig = {
  port: number;
  ollamaAdapterUrl: string;
  modelCacheTtlMs: number;
};

type CreateAppOptions = {
  config?: ModelServiceConfig;
  fetchImpl?: typeof fetch;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ModelServiceConfig {
  return {
    port: Number(env.PORT ?? 4002),
    ollamaAdapterUrl: env.OLLAMA_ADAPTER_URL ?? "http://ollama-adapter:4005",
    modelCacheTtlMs: Number(env.MODEL_CACHE_TTL_MS ?? 30_000)
  };
}

async function fetchModels(config: ModelServiceConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.ollamaAdapterUrl}/internal/provider/models`);
  return modelsResponseSchema.parse(await response.json());
}

async function warmModel(config: ModelServiceConfig, fetchImpl: typeof fetch, body: { model: string; keep_alive?: string | number }) {
  const response = await fetchImpl(`${config.ollamaAdapterUrl}/internal/provider/models/warm`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return modelWarmResponseSchema.parse(await response.json());
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "model-service",
    version: "0.1.0"
  }));

  app.get("/version", async () => ({
    service: "model-service",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/internal/models", async () => fetchModels(config, fetchImpl));
  app.post("/internal/models/warm", async (request) => warmModel(config, fetchImpl, modelWarmRequestSchema.parse(request.body ?? {})));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  app.listen({ host: "0.0.0.0", port: config.port });
}
