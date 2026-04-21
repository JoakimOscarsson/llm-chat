import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { fileURLToPath } from "node:url";
import {
  appDefaultsResponseSchema,
  createSessionRequestSchema,
  gpuMetricsResponseSchema,
  modelWarmRequestSchema,
  modelWarmResponseSchema,
  modelsResponseSchema,
  ollamaRuntimeSchema,
  queuedChatRequestPatchSchema,
  queuedChatRequestResponseSchema,
  sessionResponseSchema,
  sessionsResponseSchema
} from "@llm-chat-app/contracts";

export type ApiGatewayConfig = {
  port: number;
  chatServiceUrl: string;
  modelServiceUrl: string;
  sessionServiceUrl: string;
  metricsServiceUrl: string;
};

type CreateAppOptions = {
  config?: ApiGatewayConfig;
  fetchImpl?: typeof fetch;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiGatewayConfig {
  return {
    port: Number(env.PORT ?? 4000),
    chatServiceUrl: env.CHAT_SERVICE_URL ?? "http://chat-service:4001",
    modelServiceUrl: env.MODEL_SERVICE_URL ?? "http://model-service:4002",
    sessionServiceUrl: env.SESSION_SERVICE_URL ?? "http://session-service:4003",
    metricsServiceUrl: env.METRICS_SERVICE_URL ?? "http://metrics-service:4004"
  };
}

async function fetchModels(config: ApiGatewayConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.modelServiceUrl}/internal/models`);
  return modelsResponseSchema.parse(await response.json());
}

async function warmModel(config: ApiGatewayConfig, fetchImpl: typeof fetch, body: { model: string; keep_alive?: string | number }) {
  const response = await fetchImpl(`${config.modelServiceUrl}/internal/models/warm`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return modelWarmResponseSchema.parse(await response.json());
}

async function fetchSessions(config: ApiGatewayConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions`);
  return sessionsResponseSchema.parse(await response.json());
}

async function fetchDefaults(config: ApiGatewayConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.sessionServiceUrl}/internal/settings/defaults`);
  return appDefaultsResponseSchema.parse(await response.json());
}

async function fetchRuntime(config: ApiGatewayConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.chatServiceUrl}/internal/chat/runtime`);
  return ollamaRuntimeSchema.parse(await response.json());
}

async function patchQueuedRequest(
  config: ApiGatewayConfig,
  fetchImpl: typeof fetch,
  requestId: string,
  payload: unknown
) {
  const response = await fetchImpl(`${config.chatServiceUrl}/internal/chat/requests/${requestId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(queuedChatRequestPatchSchema.parse(payload))
  });

  return queuedChatRequestResponseSchema.parse(await response.json());
}

async function fetchServiceStatus(url: string, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl(`${url}/health`);
    const payload = (await response.json()) as { status?: string };
    return payload.status === "ok" ? "ok" : "degraded";
  } catch {
    return "degraded";
  }
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: true
  });

  void app.register(cors, { origin: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "api-gateway",
    version: "0.1.0"
  }));

  app.get("/api/health", async () => {
    const dependencies = {
      chatService: await fetchServiceStatus(config.chatServiceUrl, fetchImpl),
      modelService: await fetchServiceStatus(config.modelServiceUrl, fetchImpl),
      sessionService: await fetchServiceStatus(config.sessionServiceUrl, fetchImpl),
      metricsService: await fetchServiceStatus(config.metricsServiceUrl, fetchImpl)
    };

    const status = Object.values(dependencies).every((dependency) => dependency === "ok") ? "ok" : "degraded";

    return {
      status,
      service: "api-gateway",
      dependencies
    };
  });

  app.get("/version", async () => ({
    service: "api-gateway",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/api/runtime/ollama", async () => fetchRuntime(config, fetchImpl));

  app.get("/api/models", async () => fetchModels(config, fetchImpl));
  app.post("/api/models/warm", async (request) => warmModel(config, fetchImpl, modelWarmRequestSchema.parse(request.body ?? {})));

  app.get("/api/sessions", async () => fetchSessions(config, fetchImpl));

  app.post("/api/sessions", async (request) => {
    const payload = createSessionRequestSchema.parse(request.body ?? {});
    const upstream = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return sessionResponseSchema.parse(await upstream.json());
  });

  app.get("/api/settings/defaults", async () => fetchDefaults(config, fetchImpl));

  app.put("/api/settings/defaults", async (request) => {
    const upstream = await fetchImpl(`${config.sessionServiceUrl}/internal/settings/defaults`, {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body ?? {})
    });

    return appDefaultsResponseSchema.parse(await upstream.json());
  });

  app.get("/api/sessions/:sessionId", async (request) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const upstream = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions/${sessionId}`);
    return sessionResponseSchema.parse(await upstream.json());
  });

  app.patch("/api/sessions/:sessionId", async (request) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const upstream = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body ?? {})
    });

    return sessionResponseSchema.parse(await upstream.json());
  });

  app.post("/api/sessions/:sessionId/model-switch", async (request) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const upstream = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions/${sessionId}/model-switch`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body ?? {})
    });

    return sessionResponseSchema.parse(await upstream.json());
  });

  app.get("/api/metrics/gpu", async () => {
    const upstream = await fetchImpl(`${config.metricsServiceUrl}/internal/metrics/gpu`);
    return gpuMetricsResponseSchema.parse(await upstream.json());
  });

  app.delete("/api/sessions/:sessionId/history", async (request) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const upstream = await fetchImpl(`${config.sessionServiceUrl}/internal/sessions/${sessionId}/history`, {
      method: "DELETE"
    });

    return sessionResponseSchema.parse(await upstream.json());
  });

  app.post("/api/chat/stream", async (request, reply) => {
    const upstream = await fetchImpl(`${config.chatServiceUrl}/internal/chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body ?? {})
    });

    reply.code(upstream.status);
    reply.header("content-type", upstream.headers.get("content-type") ?? "text/event-stream");

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
  });

  app.post("/api/chat/stop", async (request) => {
    const upstream = await fetchImpl(`${config.chatServiceUrl}/internal/chat/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body ?? {})
    });

    return upstream.json();
  });

  app.patch("/api/chat/requests/:requestId", async (request) => {
    const requestId = (request.params as { requestId: string }).requestId;
    return patchQueuedRequest(config, fetchImpl, requestId, request.body ?? {});
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  app.listen({ host: "0.0.0.0", port: config.port });
}
