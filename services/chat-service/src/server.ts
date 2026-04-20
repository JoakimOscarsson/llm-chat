import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";

export type ChatServiceConfig = {
  port: number;
  sessionServiceUrl: string;
  ollamaAdapterUrl: string;
};

type CreateAppOptions = {
  config?: ChatServiceConfig;
  fetchImpl?: typeof fetch;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChatServiceConfig {
  return {
    port: Number(env.PORT ?? 4001),
    sessionServiceUrl: env.SESSION_SERVICE_URL ?? "http://session-service:4003",
    ollamaAdapterUrl: env.OLLAMA_ADAPTER_URL ?? "http://ollama-adapter:4005"
  };
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "chat-service",
    version: "0.1.0"
  }));

  app.get("/version", async () => ({
    service: "chat-service",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.post("/internal/chat/stream", async (request, reply) => {
    const upstream = await fetchImpl(`${config.ollamaAdapterUrl}/internal/provider/chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body ?? {})
    });

    reply.header("content-type", "text/event-stream");
    const text = await upstream.text();
    reply.raw.write(text);
    reply.raw.end();
    return reply;
  });

  app.post("/internal/chat/stop", async () => ({
    stopped: true
  }));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  void app.listen({ host: "0.0.0.0", port: config.port });
}
