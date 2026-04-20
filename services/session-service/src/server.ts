import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4003);
const now = () => new Date().toISOString();

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

app.get("/internal/sessions", async () => ({
  sessions: []
}));

app.get("/internal/sessions/:sessionId", async (request) => ({
  session: {
    id: (request.params as { sessionId: string }).sessionId,
    title: "Stub session",
    model: "stub-model",
    createdAt: now(),
    updatedAt: now(),
    messages: [],
    overrides: {}
  }
}));

app.get("/internal/sessions/:sessionId/context", async (request) => ({
  sessionId: (request.params as { sessionId: string }).sessionId,
  model: "stub-model",
  globalDefaults: {
    requestHistoryCount: 8,
    responseHistoryCount: 8
  },
  overrides: {},
  history: []
}));

app.listen({ host: "0.0.0.0", port });

