import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
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
  const activeRequests = new Map<string, AbortController>();

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
    const payload = (request.body ?? {}) as Record<string, unknown>;
    const requestId = typeof payload.requestId === "string" && payload.requestId.length > 0 ? payload.requestId : randomUUID();
    const abortController = new AbortController();
    const message = typeof payload.message === "string" ? payload.message : "";
    const messages = Array.isArray(payload.messages)
      ? payload.messages
      : message
        ? [{ role: "user", content: message }]
        : [];

    activeRequests.set(requestId, abortController);
    request.raw.on("close", () => {
      abortController.abort();
      activeRequests.delete(requestId);
    });

    try {
      const upstream = await fetchImpl(`${config.ollamaAdapterUrl}/internal/provider/chat/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          requestId,
          model: payload.model,
          messages,
          options: payload.options ?? {},
          streamThinking: payload.streamThinking ?? true,
          think: payload.think,
          keep_alive: payload.keep_alive
        }),
        signal: abortController.signal
      });

      reply.header("content-type", "text/event-stream");

      if (!upstream.body) {
        const text = await upstream.text();
        reply.raw.write(text);
        reply.raw.end();
        return reply;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        reply.raw.write(decoder.decode(value, { stream: true }));
      }

      const remainder = decoder.decode();
      if (remainder) {
        reply.raw.write(remainder);
      }

      reply.raw.end();
      return reply;
    } catch (error) {
      if (abortController.signal.aborted) {
        return reply.code(499).send({
          stopped: true,
          requestId
        });
      }

      throw error;
    } finally {
      activeRequests.delete(requestId);
    }
  });

  app.post("/internal/chat/stop", async (request) => {
    const payload = (request.body ?? {}) as { requestId?: string };
    const requestId = payload.requestId ?? "";
    const controller = activeRequests.get(requestId);

    if (!controller) {
      return {
        stopped: false,
        requestId
      };
    }

    controller.abort();
    activeRequests.delete(requestId);

    await fetchImpl(`${config.ollamaAdapterUrl}/internal/provider/chat/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ requestId })
    });

    return {
      stopped: true,
      requestId
    };
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  void app.listen({ host: "0.0.0.0", port: config.port });
}
