import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import {
  appDefaultsResponseSchema,
  appDefaultsSchema,
  assistantResultPersistRequestSchema,
  createSessionRequestSchema,
  modelSwitchPersistRequestSchema,
  messagePersistRequestSchema,
  sessionContextResponseSchema,
  sessionPatchSchema,
  sessionResponseSchema,
  sessionsResponseSchema,
  type AppDefaults,
  type SessionOverrides
} from "@llm-chat-app/contracts";

export type SessionServiceConfig = {
  port: number;
  sessionStoreDriver: string;
  sessionStoreUrl: string;
};

type SessionMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  kind?: "message" | "model_switch";
  model?: string;
  thinking?: {
    content: string;
    collapsedByDefault: true;
  };
};

type SessionRecord = {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  overrides: SessionOverrides;
};

type CreateAppOptions = {
  config?: SessionServiceConfig;
};

const fixedNow = "2026-04-20T18:00:00.000Z";
const createdSessionNow = "2026-04-20T18:00:01.000Z";

const initialDefaults: AppDefaults = {
  systemPrompt: "You are a concise, helpful assistant. Format responses with Markdown, short paragraphs, and lists when useful.",
  requestHistoryCount: 8,
  responseHistoryCount: 8,
  streamThinking: true,
  persistSessions: true,
  options: {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 5120,
    stop: []
  }
};

const initialSession: SessionRecord = {
  id: "sess_1",
  title: "New chat",
  model: "llama3.1:8b",
  createdAt: fixedNow,
  updatedAt: fixedNow,
  messages: [],
  overrides: {}
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SessionServiceConfig {
  return {
    port: Number(env.PORT ?? 4003),
    sessionStoreDriver: env.SESSION_STORE_DRIVER ?? "memory",
    sessionStoreUrl: env.SESSION_STORE_URL ?? ""
  };
}

function mergeDefaults(globalDefaults: AppDefaults, overrides: SessionOverrides) {
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

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  let defaults = appDefaultsSchema.parse(initialDefaults);
  const sessionStore = new Map<string, SessionRecord>([[initialSession.id, structuredClone(initialSession)]]);
  let nextSessionId = 2;

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

  app.get("/internal/settings/defaults", async () => appDefaultsResponseSchema.parse({ defaults }));

  app.put("/internal/settings/defaults", async (request) => {
    const payload = appDefaultsResponseSchema.parse(request.body ?? {});
    defaults = payload.defaults;
    return appDefaultsResponseSchema.parse({ defaults });
  });

  app.get("/internal/sessions", async () =>
    sessionsResponseSchema.parse({
      sessions: Array.from(sessionStore.values()).map((session) => ({
        id: session.id,
        title: session.title,
        model: session.model,
        updatedAt: session.updatedAt
      }))
    })
  );

  app.post("/internal/sessions", async (request) => {
    const payload = createSessionRequestSchema.parse(request.body ?? {});
    const session: SessionRecord = {
      id: `sess_${nextSessionId}`,
      title: payload.title,
      model: payload.model,
      createdAt: createdSessionNow,
      updatedAt: createdSessionNow,
      messages: [],
      overrides: {}
    };

    nextSessionId += 1;
    sessionStore.set(session.id, session);

    return sessionResponseSchema.parse({ session });
  });

  app.get("/internal/sessions/:sessionId", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return sessionResponseSchema.parse({ session });
  });

  app.patch("/internal/sessions/:sessionId", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const payload = sessionPatchSchema.parse(request.body ?? {});
    const updated: SessionRecord = {
      ...session,
      title: payload.title ?? session.title,
      model: payload.model ?? session.model,
      // Session overrides should reflect the latest saved form exactly so fields can be cleared.
      overrides: payload.overrides ?? session.overrides,
      updatedAt: fixedNow
    };

    sessionStore.set(sessionId, updated);
    return sessionResponseSchema.parse({ session: updated });
  });

  app.post("/internal/sessions/:sessionId/model-switch", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const payload = modelSwitchPersistRequestSchema.parse(request.body ?? {});
    const createdAt = payload.createdAt ?? fixedNow;
    const marker: SessionMessage = {
      id: `switch_${sessionId}_${createdAt}`,
      role: "system",
      content: "",
      createdAt,
      kind: "model_switch",
      model: payload.model
    };
    const updated: SessionRecord = {
      ...session,
      model: payload.model,
      messages: [...session.messages, marker],
      updatedAt: createdAt
    };

    sessionStore.set(sessionId, updated);
    return sessionResponseSchema.parse({ session: updated });
  });

  app.post("/internal/sessions/:sessionId/messages", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const payload = messagePersistRequestSchema.parse(request.body ?? {});
    const updated: SessionRecord = {
      ...session,
      messages: [...session.messages, payload.message],
      updatedAt: payload.message.createdAt
    };

    sessionStore.set(sessionId, updated);
    return sessionResponseSchema.parse({ session: updated });
  });

  app.post("/internal/sessions/:sessionId/assistant-result", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const payload = assistantResultPersistRequestSchema.parse(request.body ?? {});
    const updatedMessage = payload.thinking
      ? {
          ...payload.message,
          thinking: payload.thinking
        }
      : payload.message;
    const updated: SessionRecord = {
      ...session,
      messages: [...session.messages, updatedMessage],
      updatedAt: payload.message.createdAt
    };

    sessionStore.set(sessionId, updated);
    return sessionResponseSchema.parse({ session: updated });
  });

  app.delete("/internal/sessions/:sessionId/history", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const updated: SessionRecord = {
      ...session,
      messages: [],
      updatedAt: fixedNow
    };

    sessionStore.set(sessionId, updated);
    return sessionResponseSchema.parse({ session: updated });
  });

  app.get("/internal/sessions/:sessionId/context", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = sessionStore.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

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
