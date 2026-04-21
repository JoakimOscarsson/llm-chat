import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import {
  SESSION_TITLE_MAX_LENGTH,
  modelWarmRequestSchema,
  modelWarmResponseSchema,
  modelsResponseSchema
} from "@llm-chat-app/contracts";
import { assessModelCapabilities, type ModelShowPayload, type TaggedModel } from "./model-capability.js";

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

type TitlePayload = {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  maxLength?: number;
};

type UnsupportedOption = {
  key: string;
  message: string;
};

type SseReplyWriter = {
  raw: {
    write: (chunk: string) => unknown;
  };
};

type ChatStreamResolution =
  | {
      ok: true;
      upstream: Response;
    }
  | {
      ok: false;
      errorText: string;
      status: number;
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

function findUnsupportedOption(errorText: string, status: number): UnsupportedOption | null {
  if (status < 400) {
    return null;
  }

  const message = parseUpstreamErrorMessage(errorText);
  const patterns = [
    /unsupported option:\s*([a-zA-Z0-9_]+)/i,
    /unknown option:\s*([a-zA-Z0-9_]+)/i,
    /invalid option:\s*([a-zA-Z0-9_]+)/i,
    /option\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:is\s+)?not supported/i,
    /does not support\s+([a-zA-Z0-9_]+)/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);

    if (match?.[1]) {
      const key = match[1];

      if (key === "thinking" || key === "think") {
        return null;
      }

      return {
        key,
        message
      };
    }
  }

  return null;
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

async function warmModel(
  config: OllamaAdapterConfig,
  fetchImpl: typeof fetch,
  payload: { model: string; keep_alive?: string | number }
) {
  if (config.useStub) {
    return modelWarmResponseSchema.parse({
      status: "warmed",
      ready: true,
      model: payload.model,
      warmedAt: new Date().toISOString(),
      loadDuration: 0,
      totalDuration: 0
    });
  }

  const response = await fetchImpl(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Access-Client-Id": config.cfAccessClientId,
      "CF-Access-Client-Secret": config.cfAccessClientSecret
    },
    body: JSON.stringify({
      model: payload.model,
      prompt: "",
      stream: false,
      ...(payload.keep_alive !== undefined ? { keep_alive: payload.keep_alive } : {})
    })
  });

  if (!response.ok) {
    const errorText = parseUpstreamErrorMessage(await response.text());
    throw new Error(errorText || `Ollama upstream returned ${response.status}`);
  }

  const responsePayload = (await response.json()) as {
    model?: string;
    load_duration?: number;
    total_duration?: number;
  };

  return modelWarmResponseSchema.parse({
    status: "warmed",
    ready: true,
    model: responsePayload.model ?? payload.model,
    warmedAt: new Date().toISOString(),
    loadDuration: responsePayload.load_duration,
    totalDuration: responsePayload.total_duration
  });
}

function withoutUnsupportedOption(payload: ChatPayload, key: string): ChatPayload {
  const currentOptions = payload.options ?? {};

  if (!(key in currentOptions)) {
    return payload;
  }

  const nextOptions = { ...currentOptions };
  delete nextOptions[key];

  return {
    ...payload,
    options: nextOptions
  };
}

function writeSseEvent(reply: SseReplyWriter, event: string, data: Record<string, unknown>) {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function resolveChatStreamWithFallbacks(args: {
  config: OllamaAdapterConfig;
  fetchImpl: typeof fetch;
  abortSignal: AbortSignal;
  payload: ChatPayload;
  requestId: string;
  model: string;
  reply: SseReplyWriter;
}): Promise<ChatStreamResolution> {
  let activePayload = args.payload;
  let includeThink = args.payload.streamThinking ?? true;
  const appliedFallbacks = new Set<string>();
  const maxAttempts = 1 + Object.keys(args.payload.options ?? {}).length + (includeThink ? 1 : 0);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const upstream = await fetchChatStream(
      args.config,
      args.fetchImpl,
      args.abortSignal,
      activePayload,
      includeThink
    );

    if (upstream.ok && upstream.body) {
      return {
        ok: true,
        upstream
      };
    }

    const errorText = parseUpstreamErrorMessage(await upstream.text());

    if (includeThink && thinkingUnsupported(errorText, upstream.status) && !appliedFallbacks.has("think")) {
      includeThink = false;
      appliedFallbacks.add("think");
      writeSseEvent(args.reply, "thinking_unavailable", {
        requestId: args.requestId,
        model: args.model,
        attempt: attempt + 1,
        text: "This model does not support thinking. Streaming the answer without it."
      });
      continue;
    }

    const unsupportedOption = findUnsupportedOption(errorText, upstream.status);

    if (unsupportedOption) {
      const nextPayload = withoutUnsupportedOption(activePayload, unsupportedOption.key);

      if (nextPayload !== activePayload && !appliedFallbacks.has(`option:${unsupportedOption.key}`)) {
        activePayload = nextPayload;
        appliedFallbacks.add(`option:${unsupportedOption.key}`);
        writeSseEvent(args.reply, "settings_notice", {
          option: unsupportedOption.key,
          attempt: attempt + 1,
          text: `This model does not support the ${unsupportedOption.key} setting. Retrying without it.`
        });
        continue;
      }
    }

    return {
      ok: false,
      errorText,
      status: upstream.status
    };
  }

  return {
    ok: false,
    errorText: "Ollama upstream kept rejecting supported fallback settings.",
    status: 502
  };
}

function sanitizeTitleCandidate(input: string, maxLength: number) {
  const collapsed = input
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!collapsed) {
    return "";
  }

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  const sliced = collapsed.slice(0, maxLength).trim();
  const lastWhitespace = sliced.lastIndexOf(" ");

  if (lastWhitespace >= 12) {
    return sliced.slice(0, lastWhitespace).trim();
  }

  return sliced;
}

function fallbackTitleFromPrompt(messages: Array<{ role: string; content: string }> | undefined, maxLength: number) {
  const firstUserMessage = messages?.find((message) => message.role === "user")?.content ?? "New chat";
  const cleaned = firstUserMessage
    .replace(/[`*_#>[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}\s:/.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "New chat";
  }

  const withoutLeadingInstruction = cleaned.replace(/^(please|can you|could you|help me|i need|show me)\s+/i, "").trim();
  const candidate = sanitizeTitleCandidate(withoutLeadingInstruction || cleaned, maxLength);

  return candidate || "New chat";
}

function extractTitleCandidate(rawContent: string) {
  const trimmed = rawContent.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { title?: unknown };

    if (typeof parsed.title === "string") {
      return parsed.title;
    }
  } catch {
    const titleMatch = trimmed.match(/["']title["']\s*:\s*["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/i);

    if (titleMatch) {
      return titleMatch[1].replace(/\\"/g, "\"").replace(/\\n/g, " ").trim();
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return "";
    }
  }

  return trimmed;
}

async function generateChatTitle(
  config: OllamaAdapterConfig,
  fetchImpl: typeof fetch,
  payload: TitlePayload
) {
  const maxLength = Math.min(Math.max(payload.maxLength ?? SESSION_TITLE_MAX_LENGTH, 8), SESSION_TITLE_MAX_LENGTH);

  if (config.useStub) {
    return {
      title: fallbackTitleFromPrompt(payload.messages, maxLength)
    };
  }

  try {
    const response = await fetchImpl(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Access-Client-Id": config.cfAccessClientId,
        "CF-Access-Client-Secret": config.cfAccessClientSecret
      },
      body: JSON.stringify({
        model: payload.model ?? "llama3.1:8b",
        messages: payload.messages ?? [],
        stream: false,
        think: false,
        format: "json",
        options: {
          temperature: 0.2,
          num_predict: 24
        }
      })
    });

    if (!response.ok) {
      const errorText = parseUpstreamErrorMessage(await response.text());
      throw new Error(errorText || `Ollama upstream returned ${response.status}`);
    }

    const responsePayload = (await response.json()) as {
      message?: {
        content?: string;
      };
    };
    const rawContent = responsePayload.message?.content ?? "";
    const title = extractTitleCandidate(rawContent);

    const sanitized = sanitizeTitleCandidate(title, maxLength);

    if (sanitized) {
      return {
        title: sanitized
      };
    }
  } catch {
    // Fall back to a prompt-derived title if the model cannot or will not produce one.
  }

  return {
    title: fallbackTitleFromPrompt(payload.messages, maxLength)
  };
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
          size: 4661224676,
          chatCapable: true,
          capabilitySource: "stub",
          capabilities: ["completion"],
          family: "llama",
          families: ["llama"]
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
    models?: TaggedModel[];
  };

  const models = await Promise.all(
    (payload.models ?? []).map(async (model) => {
      let showPayload: ModelShowPayload | undefined;

      try {
        const showResponse = await fetchImpl(`${config.ollamaBaseUrl}/api/show`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "CF-Access-Client-Id": config.cfAccessClientId,
            "CF-Access-Client-Secret": config.cfAccessClientSecret
          },
          body: JSON.stringify({
            model: model.name,
            verbose: false
          })
        });

        if (showResponse.ok) {
          showPayload = (await showResponse.json()) as ModelShowPayload;
        }
      } catch {
        // Fall back to tag metadata when show lookups fail.
      }

      const capabilityAssessment = assessModelCapabilities(model, showPayload);

      return {
        name: model.name,
        modifiedAt: model.modified_at ?? new Date(0).toISOString(),
        size: model.size ?? 0,
        ...capabilityAssessment
      };
    })
  );

  return modelsResponseSchema.parse({
    models,
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

  app.post("/internal/provider/models/warm", async (request) => {
    const payload = modelWarmRequestSchema.parse(request.body ?? {});
    return warmModel(config, fetchImpl, payload);
  });

  app.post("/internal/provider/chat/stream", async (request, reply) => {
    const payload = (request.body ?? {}) as ChatPayload;
    const requestId = payload.requestId ?? "stub-request";
    const model = payload.model ?? "llama3.1:8b";

    reply.header("content-type", "text/event-stream");
    writeSseEvent(reply, "meta", { requestId, model });

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
      const streamResolution = await resolveChatStreamWithFallbacks({
        config,
        fetchImpl,
        abortSignal: abortController.signal,
        payload,
        requestId,
        model,
        reply
      });

      if (!streamResolution.ok) {
        writeSseEvent(reply, "error", {
          requestId,
          model,
          message: streamResolution.errorText || `Ollama upstream returned ${streamResolution.status}`,
          status: streamResolution.status
        });
        reply.raw.end();
        return reply;
      }

      const upstream = streamResolution.upstream;
      const upstreamBody = upstream.body;

      if (!upstreamBody) {
        writeSseEvent(reply, "error", {
          requestId,
          model,
          message: "Ollama upstream did not provide a stream body.",
          status: 502
        });
        reply.raw.end();
        return reply;
      }

      const reader = upstreamBody.getReader();
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
            writeSseEvent(reply, "thinking_delta", { text: chunk.message.thinking });
          }

          if (chunk.message?.content) {
            writeSseEvent(reply, "response_delta", { text: chunk.message.content });
          }

          if (chunk.done) {
            writeSseEvent(reply, "usage", {
              totalDuration: chunk.total_duration,
              loadDuration: chunk.load_duration,
              promptEvalCount: chunk.prompt_eval_count,
              promptEvalDuration: chunk.prompt_eval_duration,
              evalCount: chunk.eval_count,
              evalDuration: chunk.eval_duration
            });
            writeSseEvent(reply, "done", { finishReason: chunk.done_reason ?? "stop" });
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
          writeSseEvent(reply, "thinking_delta", { text: chunk.message.thinking });
        }

        if (chunk.message?.content) {
          writeSseEvent(reply, "response_delta", { text: chunk.message.content });
        }

        if (chunk.done) {
          writeSseEvent(reply, "usage", {
            totalDuration: chunk.total_duration,
            loadDuration: chunk.load_duration,
            promptEvalCount: chunk.prompt_eval_count,
            promptEvalDuration: chunk.prompt_eval_duration,
            evalCount: chunk.eval_count,
            evalDuration: chunk.eval_duration
          });
          writeSseEvent(reply, "done", { finishReason: chunk.done_reason ?? "stop" });
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

  app.post("/internal/provider/chat/title", async (request) => {
    const payload = (request.body ?? {}) as TitlePayload;
    return generateChatTitle(config, fetchImpl, payload);
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
