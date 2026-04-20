import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sessionContextResponseSchema, type AppDefaults, type SessionOverrides } from "@llm-chat-app/contracts";

export type ChatServiceConfig = {
  port: number;
  sessionServiceUrl: string;
  ollamaAdapterUrl: string;
};

type CreateAppOptions = {
  config?: ChatServiceConfig;
  fetchImpl?: typeof fetch;
};

type ChatStreamRequest = {
  requestId?: string;
  sessionId?: string;
  model?: string;
  message?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  streamThinking?: boolean;
  think?: boolean | string;
  keep_alive?: string | number;
};

type SessionContext = {
  sessionId: string;
  model: string;
  globalDefaults: AppDefaults;
  overrides: SessionOverrides;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChatServiceConfig {
  return {
    port: Number(env.PORT ?? 4001),
    sessionServiceUrl: env.SESSION_SERVICE_URL ?? "http://session-service:4003",
    ollamaAdapterUrl: env.OLLAMA_ADAPTER_URL ?? "http://ollama-adapter:4005"
  };
}

function resolveSettings(globalDefaults: AppDefaults, overrides: SessionOverrides) {
  return {
    systemPrompt: overrides.systemPrompt ?? globalDefaults.systemPrompt,
    streamThinking: globalDefaults.streamThinking,
    options: {
      ...globalDefaults.options,
      ...("temperature" in overrides ? { temperature: overrides.temperature } : {}),
      ...("top_k" in overrides ? { top_k: overrides.top_k } : {}),
      ...("top_p" in overrides ? { top_p: overrides.top_p } : {}),
      ...("repeat_penalty" in overrides ? { repeat_penalty: overrides.repeat_penalty } : {}),
      ...("seed" in overrides ? { seed: overrides.seed } : {}),
      ...("num_ctx" in overrides ? { num_ctx: overrides.num_ctx } : {}),
      ...("num_predict" in overrides ? { num_predict: overrides.num_predict } : {}),
      ...("stop" in overrides ? { stop: overrides.stop } : {}),
      ...("keep_alive" in overrides ? { keep_alive: overrides.keep_alive } : {})
    }
  };
}

async function fetchSessionContext(
  config: ChatServiceConfig,
  fetchImpl: typeof fetch,
  sessionId: string
): Promise<SessionContext> {
  const response = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions/${sessionId}/context`);
  return sessionContextResponseSchema.parse(await response.json());
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
    const payload = (request.body ?? {}) as ChatStreamRequest;
    const requestId = typeof payload.requestId === "string" && payload.requestId.length > 0 ? payload.requestId : randomUUID();
    const abortController = new AbortController();
    const message = typeof payload.message === "string" ? payload.message : "";
    const directMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const sessionId = typeof payload.sessionId === "string" && payload.sessionId.length > 0 ? payload.sessionId : undefined;

    activeRequests.set(requestId, abortController);
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
        activeRequests.delete(requestId);
      }
    });

    try {
      let model = payload.model;
      let messages = directMessages;
      let options = payload.options ?? {};
      let streamThinking = payload.streamThinking ?? true;
      let keepAlive = payload.keep_alive;

      if (sessionId) {
        const context = await fetchSessionContext(config, fetchImpl, sessionId);
        const resolved = resolveSettings(context.globalDefaults, context.overrides);

        model = payload.model ?? context.model;
        streamThinking = payload.streamThinking ?? resolved.streamThinking;
        keepAlive = payload.keep_alive ?? resolved.options.keep_alive;
        options = {
          ...resolved.options,
          ...(payload.options ?? {})
        };
        messages = [
          ...(resolved.systemPrompt ? [{ role: "system", content: resolved.systemPrompt }] : []),
          ...context.history,
          ...(message ? [{ role: "user", content: message }] : directMessages)
        ];
      } else if (message && messages.length === 0) {
        messages = [{ role: "user", content: message }];
      }

      const upstream = await fetchImpl(`${config.ollamaAdapterUrl}/internal/provider/chat/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          requestId,
          model,
          messages,
          options,
          streamThinking,
          think: payload.think,
          keep_alive: keepAlive
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
