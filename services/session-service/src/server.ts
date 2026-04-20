import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { sessionsResponseSchema, sessionSchema } from "@llm-chat-app/contracts";

export type SessionServiceConfig = {
  port: number;
  sessionStoreDriver: string;
  sessionStoreUrl: string;
};

const fixedNow = "2026-04-20T18:00:00.000Z";
const sessions = [
  {
    id: "sess_1",
    title: "New chat",
    model: "llama3.1:8b",
    updatedAt: fixedNow
  }
];

type CreateAppOptions = {
  config?: SessionServiceConfig;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SessionServiceConfig {
  return {
    port: Number(env.PORT ?? 4003),
    sessionStoreDriver: env.SESSION_STORE_DRIVER ?? "memory",
    sessionStoreUrl: env.SESSION_STORE_URL ?? ""
  };
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "session-service",
    version: "0.1.0"
  }));

  app.get("/version", async () => ({
    service: "session-service",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/internal/sessions", async () => sessionsResponseSchema.parse({ sessions }));

  app.get("/internal/sessions/:sessionId", async (request) => ({
    session: sessionSchema.parse({
      id: (request.params as { sessionId: string }).sessionId,
      title: "Stub session",
      model: "llama3.1:8b",
      createdAt: fixedNow,
      updatedAt: fixedNow,
      messages: [],
      overrides: {}
    })
  }));

  app.get("/internal/sessions/:sessionId/context", async (request) => ({
    sessionId: (request.params as { sessionId: string }).sessionId,
    model: "llama3.1:8b",
    globalDefaults: {
      requestHistoryCount: 8,
      responseHistoryCount: 8
    },
    overrides: {},
    history: []
  }));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  app.listen({ host: "0.0.0.0", port: config.port });
}
