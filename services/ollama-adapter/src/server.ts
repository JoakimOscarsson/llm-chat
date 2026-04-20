import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { modelsResponseSchema } from "@llm-chat-app/contracts";

export type OllamaAdapterConfig = {
  port: number;
  ollamaBaseUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  ollamaTimeoutMs: number;
  useStub: boolean;
};

type CreateAppOptions = {
  config?: OllamaAdapterConfig;
  fetchImpl?: typeof fetch;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OllamaAdapterConfig {
  return {
    port: Number(env.PORT ?? 4005),
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "https://ollama.example.com",
    cfAccessClientId: env.CF_ACCESS_CLIENT_ID ?? "",
    cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET ?? "",
    ollamaTimeoutMs: Number(env.OLLAMA_TIMEOUT_MS ?? 60_000),
    useStub: env.OLLAMA_USE_STUB === "true"
  };
}

async function fetchModels(config: OllamaAdapterConfig, fetchImpl: typeof fetch) {
  if (config.useStub) {
    return modelsResponseSchema.parse({
      models: [
        {
          name: "llama3.1:8b",
          modifiedAt: "2026-04-20T18:00:00.000Z",
          size: 4661224676
        }
      ],
      fetchedAt: new Date().toISOString()
    });
  }

  const response = await fetchImpl(`${config.ollamaBaseUrl}/api/tags`, {
    headers: {
      "CF-Access-Client-Id": config.cfAccessClientId,
      "CF-Access-Client-Secret": config.cfAccessClientSecret
    }
  });

  const payload = (await response.json()) as {
    models?: Array<{ name: string; modified_at?: string; size?: number }>;
  };

  return modelsResponseSchema.parse({
    models: (payload.models ?? []).map((model) => ({
      name: model.name,
      modifiedAt: model.modified_at ?? new Date(0).toISOString(),
      size: model.size ?? 0
    })),
    fetchedAt: new Date().toISOString()
  });
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "ollama-adapter",
    version: "0.1.0"
  }));

  app.get("/version", async () => ({
    service: "ollama-adapter",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/internal/provider/models", async () => fetchModels(config, fetchImpl));

  app.post("/internal/provider/chat/stream", async (_request, reply) => {
    reply.header("content-type", "text/event-stream");
    reply.raw.write("event: provider_meta\n");
    reply.raw.write(`data: ${JSON.stringify({ provider: "ollama", requestId: "stub-request" })}\n\n`);
    reply.raw.write("event: done\n");
    reply.raw.write(`data: ${JSON.stringify({ finishReason: "stub" })}\n\n`);
    reply.raw.end();
    return reply;
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  void app.listen({ host: "0.0.0.0", port: config.port });
}
