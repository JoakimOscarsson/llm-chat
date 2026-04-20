import Fastify from "fastify";
import cors from "@fastify/cors";

const port = Number(process.env.PORT ?? 4000);

const app = Fastify({
  logger: true
});

await app.register(cors, { origin: true });

app.get("/health", async () => ({
  status: "ok",
  service: "api-gateway",
  version: "0.1.0"
}));

app.get("/version", async () => ({
  service: "api-gateway",
  version: "0.1.0",
  contractVersion: "v1"
}));

app.get("/api/models", async () => ({
  models: [],
  fetchedAt: new Date().toISOString()
}));

app.get("/api/sessions", async () => ({
  sessions: []
}));

app.listen({ host: "0.0.0.0", port });

