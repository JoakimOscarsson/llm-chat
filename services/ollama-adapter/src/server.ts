import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { modelsResponseSchema } from "@llm-chat-app/contracts";

export type OllamaAdapterConfig = {
  port: number;
  ollamaBaseUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  ollamaTimeoutMs: number;
  useStub: boolean;
};

type CreateAppOptions = {
  config?: OllamaAdapterConfig;
  fetchImpl?: typeof fetch;
};

type ChatPayload = {
  requestId?: string;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  streamThinking?: boolean;
  think?: boolean | string;
  keep_alive?: string | number;
};

function parseUpstreamErrorMessage(errorText: string) {
  const trimmed = errorText.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown };

    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Fall back to the raw upstream text when the payload is not JSON.
  }

  return trimmed;
}

function thinkingUnsupported(errorText: string, status: number) {
  if (status < 400) {
    return false;
  }

  const message = parseUpstreamErrorMessage(errorText);

  return (
    /(does not support thinking|thinking.*not supported|unsupported.*thinking|unknown.*think|invalid.*think)/i.test(message) ||
    /(think|thinking).*(unsupported|not supported|unknown|invalid)|unsupported.*(think|thinking)/i.test(message)
  );
}

async function fetchChatStream(
  config: OllamaAdapterConfig,
  fetchImpl: typeof fetch,
  abortSignal: AbortSignal,
  payload: ChatPayload,
  includeThink: boolean
) {
  const body: Record<string, unknown> = {
    model: payload.model ?? "llama3.1:8b",
    messages: payload.messages ?? [],
    options: payload.options ?? {},
    keep_alive: payload.keep_alive,
    stream: true
  };

  if (includeThink) {
    body.think = payload.think ?? payload.streamThinking ?? true;
  }

  return fetchImpl(`${config.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Access-Client-Id": config.cfAccessClientId,
      "CF-Access-Client-Secret": config.cfAccessClientSecret
    },
    body: JSON.stringify(body),
    signal: abortSignal
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OllamaAdapterConfig {
  return {
    port: Number(env.PORT ?? 4005),
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "https://ollama.example.com",
    cfAccessClientId: env.CF_ACCESS_CLIENT_ID ?? "",
    cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET ?? "",
    ollamaTimeoutMs: Number(env.OLLAMA_TIMEOUT_MS ?? 60_000),
    useStub: env.OLLAMA_USE_STUB === "true"
  };
}

async function fetchModels(config: OllamaAdapterConfig, fetchImpl: typeof fetch) {
  if (config.useStub) {
    return modelsResponseSchema.parse({
      models: [
        {
          name: "llama3.1:8b",
          modifiedAt: "2026-04-20T18:00:00.000Z",
          size: 4661224676
        }
      ],
      fetchedAt: new Date().toISOString()
    });
  }

  const response = await fetchImpl(`${config.ollamaBaseUrl}/api/tags`, {
    headers: {
      "CF-Access-Client-Id": config.cfAccessClientId,
      "CF-Access-Client-Secret": config.cfAccessClientSecret
    }
  });

  const payload = (await response.json()) as {
    models?: Array<{ name: string; modified_at?: string; size?: number }>;
  };

  return modelsResponseSchema.parse({
    models: (payload.models ?? []).map((model) => ({
      name: model.name,
      modifiedAt: model.modified_at ?? new Date(0).toISOString(),
      size: model.size ?? 0
    })),
    fetchedAt: new Date().toISOString()
  });
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const activeRequests = new Map<string, AbortController>();

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

  app.get("/internal/provider/models", async () => fetchModels(config, fetchImpl));

  app.post("/internal/provider/chat/stream", async (request, reply) => {
    const payload = (request.body ?? {}) as ChatPayload;
    const requestId = payload.requestId ?? "stub-request";
    const model = payload.model ?? "llama3.1:8b";

    reply.header("content-type", "text/event-stream");
    reply.raw.write("event: meta\n");
    reply.raw.write(`data: ${JSON.stringify({ requestId, model })}\n\n`);

    if (config.useStub) {
      reply.raw.write("event: thinking_delta\n");
      reply.raw.write(`data: ${JSON.stringify({ text: "Thinking..." })}\n\n`);
      reply.raw.write("event: response_delta\n");
      reply.raw.write(`data: ${JSON.stringify({ text: "Hello there" })}\n\n`);
      reply.raw.write("event: done\n");
      reply.raw.write(`data: ${JSON.stringify({ finishReason: "stub" })}\n\n`);
      reply.raw.end();
      return reply;
    }

    const abortController = new AbortController();
    activeRequests.set(requestId, abortController);
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
        activeRequests.delete(requestId);
      }
    });

    try {
      let upstream = await fetchChatStream(config, fetchImpl, abortController.signal, payload, true);

      if (!upstream.ok || !upstream.body) {
        const errorText = parseUpstreamErrorMessage(await upstream.text());

        if ((payload.streamThinking ?? true) && thinkingUnsupported(errorText, upstream.status)) {
          reply.raw.write("event: thinking_unavailable\n");
          reply.raw.write(
            `data: ${JSON.stringify({
              requestId,
              model,
              text: "This model does not support thinking. Streaming the answer without it."
            })}\n\n`
          );
          upstream = await fetchChatStream(config, fetchImpl, abortController.signal, payload, false);
        } else {
          reply.raw.write("event: error\n");
          reply.raw.write(
            `data: ${JSON.stringify({
              requestId,
              model,
              message: errorText || `Ollama upstream returned ${upstream.status}`,
              status: upstream.status
            })}\n\n`
          );
          reply.raw.end();
          return reply;
        }
      }

      if (!upstream.ok || !upstream.body) {
        const errorText = parseUpstreamErrorMessage(await upstream.text());
        reply.raw.write("event: error\n");
        reply.raw.write(
          `data: ${JSON.stringify({
            requestId,
            model,
            message: errorText || `Ollama upstream returned ${upstream.status}`,
            status: upstream.status
          })}\n\n`
        );
        reply.raw.end();
        return reply;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          const chunk = JSON.parse(trimmed) as {
            done?: boolean;
            done_reason?: string;
            message?: { content?: string; thinking?: string };
            total_duration?: number;
            load_duration?: number;
            prompt_eval_count?: number;
            prompt_eval_duration?: number;
            eval_count?: number;
            eval_duration?: number;
          };

          if (chunk.message?.thinking) {
            reply.raw.write("event: thinking_delta\n");
            reply.raw.write(`data: ${JSON.stringify({ text: chunk.message.thinking })}\n\n`);
          }

          if (chunk.message?.content) {
            reply.raw.write("event: response_delta\n");
            reply.raw.write(`data: ${JSON.stringify({ text: chunk.message.content })}\n\n`);
          }

          if (chunk.done) {
            reply.raw.write("event: usage\n");
            reply.raw.write(
              `data: ${JSON.stringify({
                totalDuration: chunk.total_duration,
                loadDuration: chunk.load_duration,
                promptEvalCount: chunk.prompt_eval_count,
                promptEvalDuration: chunk.prompt_eval_duration,
                evalCount: chunk.eval_count,
                evalDuration: chunk.eval_duration
              })}\n\n`
            );
            reply.raw.write("event: done\n");
            reply.raw.write(`data: ${JSON.stringify({ finishReason: chunk.done_reason ?? "stop" })}\n\n`);
          }
        }
      }

      const remainder = buffer.trim();
      if (remainder) {
        const chunk = JSON.parse(remainder) as {
          done?: boolean;
          done_reason?: string;
          message?: { content?: string; thinking?: string };
          total_duration?: number;
          load_duration?: number;
          prompt_eval_count?: number;
          prompt_eval_duration?: number;
          eval_count?: number;
          eval_duration?: number;
        };

        if (chunk.message?.thinking) {
          reply.raw.write("event: thinking_delta\n");
          reply.raw.write(`data: ${JSON.stringify({ text: chunk.message.thinking })}\n\n`);
        }

        if (chunk.message?.content) {
          reply.raw.write("event: response_delta\n");
          reply.raw.write(`data: ${JSON.stringify({ text: chunk.message.content })}\n\n`);
        }

        if (chunk.done) {
          reply.raw.write("event: usage\n");
          reply.raw.write(
            `data: ${JSON.stringify({
              totalDuration: chunk.total_duration,
              loadDuration: chunk.load_duration,
              promptEvalCount: chunk.prompt_eval_count,
              promptEvalDuration: chunk.prompt_eval_duration,
              evalCount: chunk.eval_count,
              evalDuration: chunk.eval_duration
            })}\n\n`
          );
          reply.raw.write("event: done\n");
          reply.raw.write(`data: ${JSON.stringify({ finishReason: chunk.done_reason ?? "stop" })}\n\n`);
        }
      }

      reply.raw.end();
      return reply;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        reply.raw.write("event: done\n");
        reply.raw.write(`data: ${JSON.stringify({ finishReason: "aborted" })}\n\n`);
        reply.raw.end();
        return reply;
      }

      reply.raw.write("event: error\n");
      reply.raw.write(
        `data: ${JSON.stringify({
          requestId,
          model,
          message: error instanceof Error ? error.message : "Unknown upstream error"
        })}\n\n`
      );
      reply.raw.end();
      return reply;
    } finally {
      activeRequests.delete(requestId);
    }
  });

  app.post("/internal/provider/chat/stop", async (request) => {
    const payload = (request.body ?? {}) as { requestId?: string };
    const requestId = payload.requestId ?? "";
    const controller = activeRequests.get(requestId);

    if (controller) {
      controller.abort();
      activeRequests.delete(requestId);
    }

    return {
      stopped: true,
      requestId
    };
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const config = loadConfig();
  void app.listen({ host: "0.0.0.0", port: config.port });
}
