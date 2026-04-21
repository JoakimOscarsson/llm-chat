import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import {
  appDefaultsResponseSchema,
  assistantResultPersistRequestSchema,
  createSessionRequestSchema,
  messagePersistRequestSchema,
  modelSwitchPersistRequestSchema,
  sessionContextResponseSchema,
  sessionPatchSchema,
  sessionResponseSchema,
  sessionsResponseSchema,
  type SessionOverrides
} from "@llm-chat-app/contracts";
import { createdSessionNow, fixedNow } from "./defaults.js";
import { createMemorySessionStore } from "./stores/memory.js";
import { createPostgresSessionStore } from "./stores/postgres.js";
import type { SessionMessage, SessionStore } from "./store.js";

export type SessionServiceConfig = {
  port: number;
  sessionStoreDriver: string;
  sessionStoreUrl: string;
};

type CreateAppOptions = {
  config?: SessionServiceConfig;
  store?: SessionStore;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SessionServiceConfig {
  return {
    port: Number(env.PORT ?? 4003),
    sessionStoreDriver: env.SESSION_STORE_DRIVER ?? "postgres",
    sessionStoreUrl: env.SESSION_STORE_URL ?? "postgresql://postgres:postgres@postgres:5432/llm_chat"
  };
}

function mergeDefaults(
  globalDefaults: Awaited<ReturnType<SessionStore["getDefaults"]>>,
  overrides: SessionOverrides
) {
  return {
    systemPrompt: overrides.systemPrompt ?? globalDefaults.systemPrompt,
    requestHistoryCount: overrides.requestHistoryCount ?? globalDefaults.requestHistoryCount,
    responseHistoryCount: overrides.responseHistoryCount ?? globalDefaults.responseHistoryCount,
    streamThinking: globalDefaults.streamThinking,
    persistSessions: globalDefaults.persistSessions,
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

function selectHistory(messages: SessionMessage[], requestHistoryCount: number, responseHistoryCount: number) {
  const included = new Set<number>();
  let userCount = 0;
  let assistantCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "user" && userCount < requestHistoryCount) {
      included.add(index);
      userCount += 1;
    }

    if (message.role === "assistant" && assistantCount < responseHistoryCount) {
      included.add(index);
      assistantCount += 1;
    }
  }

  return messages
    .filter((_, index) => included.has(index))
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content
    }));
}

function createStore(config: SessionServiceConfig) {
  if (config.sessionStoreDriver === "memory") {
    return createMemorySessionStore();
  }

  return createPostgresSessionStore({
    connectionString: config.sessionStoreUrl
  });
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const store = options.store ?? createStore(config);
  const ready = Promise.resolve().then(() => store.init());

  const app = Fastify({
    logger: true
  });

  app.addHook("onReady", async () => {
    await ready;
  });

  app.addHook("onClose", async () => {
    await store.close();
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "session-service",
    version: "0.1.0",
    storage: config.sessionStoreDriver
  }));

  app.get("/version", async () => ({
    service: "session-service",
    version: "0.1.0",
    contractVersion: "v1"
  }));

  app.get("/internal/settings/defaults", async () => {
    await ready;
    return appDefaultsResponseSchema.parse({ defaults: await store.getDefaults() });
  });

  app.put("/internal/settings/defaults", async (request) => {
    await ready;
    const payload = appDefaultsResponseSchema.parse(request.body ?? {});
    const defaults = await store.setDefaults(payload.defaults);
    return appDefaultsResponseSchema.parse({ defaults });
  });

  app.get("/internal/sessions", async () => {
    await ready;
    return sessionsResponseSchema.parse({
      sessions: await store.listSessions()
    });
  });

  app.post("/internal/sessions", async (request) => {
    await ready;
    const payload = createSessionRequestSchema.parse(request.body ?? {});
    const session = await store.createSession({
      title: payload.title,
      model: payload.model,
      createdAt: createdSessionNow
    });
    return sessionResponseSchema.parse({ session });
  });

  app.get("/internal/sessions/:sessionId", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await store.getSession(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.patch("/internal/sessions/:sessionId", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const payload = sessionPatchSchema.parse(request.body ?? {});
    const session = await store.updateSession(sessionId, {
      title: payload.title,
      model: payload.model,
      overrides: payload.overrides,
      updatedAt: fixedNow
    });

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.post("/internal/sessions/:sessionId/model-switch", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const payload = modelSwitchPersistRequestSchema.parse(request.body ?? {});
    const session = await store.appendModelSwitch(sessionId, {
      model: payload.model,
      createdAt: payload.createdAt ?? fixedNow
    });

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.post("/internal/sessions/:sessionId/messages", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const payload = messagePersistRequestSchema.parse(request.body ?? {});
    const session = await store.appendMessage(sessionId, payload.message);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.post("/internal/sessions/:sessionId/assistant-result", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const payload = assistantResultPersistRequestSchema.parse(request.body ?? {});
    const session = await store.appendAssistantResult(sessionId, payload);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.delete("/internal/sessions/:sessionId/history", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await store.clearHistory(sessionId, fixedNow);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.get("/internal/sessions/:sessionId/context", async (request, reply) => {
    await ready;
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await store.getSession(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const defaults = await store.getDefaults();
    const resolved = mergeDefaults(defaults, session.overrides);

    return sessionContextResponseSchema.parse({
      sessionId: session.id,
      model: session.model,
      globalDefaults: defaults,
      overrides: session.overrides,
      history: selectHistory(session.messages, resolved.requestHistoryCount, resolved.responseHistoryCount)
    });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  void app.listen({ host: "0.0.0.0", port: config.port });
}
