import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4002);

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

app.get("/internal/models", async () => ({
  models: [],
  fetchedAt: new Date().toISOString()
}));

app.listen({ host: "0.0.0.0", port });

