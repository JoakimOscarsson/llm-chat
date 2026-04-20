import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4001);

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

app.post("/internal/chat/stream", async (_request, reply) => {
  reply.header("content-type", "text/event-stream");
  reply.raw.write('event: meta\n');
  reply.raw.write(`data: ${JSON.stringify({ requestId: "stub-request", model: "stub-model" })}\n\n`);
  reply.raw.write('event: done\n');
  reply.raw.write(`data: ${JSON.stringify({ finishReason: "stub" })}\n\n`);
  reply.raw.end();
  return reply;
});

app.post("/internal/chat/stop", async () => ({
  stopped: true
}));

app.listen({ host: "0.0.0.0", port });

