import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4004);

const app = Fastify({
  logger: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "metrics-service",
  version: "0.1.0"
}));

app.get("/version", async () => ({
  service: "metrics-service",
  version: "0.1.0",
  contractVersion: "v1"
}));

app.get("/internal/metrics/gpu", async () => ({
  status: "unavailable",
  sampledAt: new Date().toISOString(),
  reason: "not_configured"
}));

app.listen({ host: "0.0.0.0", port });

