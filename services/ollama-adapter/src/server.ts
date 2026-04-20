import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4005);

const app = Fastify({
  logger: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "ollama-adapter",
  version: "0.1.0"
}));

app.get("/version", async () => ({
  service: "ollama-adapter",
  version: "0.1.0",
  contractVersion: "v1"
}));

app.get("/internal/provider/models", async () => ({
  models: [],
  fetchedAt: new Date().toISOString()
}));

app.post("/internal/provider/chat/stream", async (_request, reply) => {
  reply.header("content-type", "text/event-stream");
  reply.raw.write('event: provider_meta\n');
  reply.raw.write(`data: ${JSON.stringify({ provider: "ollama", requestId: "stub-request" })}\n\n`);
  reply.raw.write('event: done\n');
  reply.raw.write(`data: ${JSON.stringify({ finishReason: "stub" })}\n\n`);
  reply.raw.end();
  return reply;
});

app.listen({ host: "0.0.0.0", port });

