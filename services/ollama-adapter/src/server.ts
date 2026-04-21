import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  SESSION_TITLE_MAX_LENGTH,
  modelWarmRequestSchema,
  modelWarmResponseSchema,
  modelsResponseSchema,
  ollamaRuntimeSchema,
  queuedChatRequestPatchSchema,
  queuedChatRequestResponseSchema
} from "@llm-chat-app/contracts";
import {
  InMemoryQueueCoordinator,
  RedisQueueCoordinator,
  type QueueCoordinator,
  type QueueRequestSnapshot
} from "./coordination.js";
import { assessModelCapabilities, type ModelShowPayload, type TaggedModel } from "./model-capability.js";

export type OllamaAdapterConfig = {
  port: number;
  ollamaBaseUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  ollamaTimeoutMs: number;
  useStub: boolean;
  redisUrl: string;
  maxParallelRequests: number;
  queuePromptAfterMs: number;
  runtimeStatusTtlMs: number;
  podInstanceId: string;
};

type CreateAppOptions = {
  config?: Partial<OllamaAdapterConfig>;
  fetchImpl?: typeof fetch;
  coordinationStore?: QueueCoordinator;
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
    destroyed?: boolean;
    writableEnded?: boolean;
    write: (chunk: string) => unknown;
    end: () => unknown;
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

type RuntimeCache = {
  fetchedAtMs: number;
  residentModels: string[];
  fastPathModels: string[];
};

const POD_HEARTBEAT_INTERVAL_MS = 2_000;
const STALE_RECOVERY_INTERVAL_MS = 2_000;
const QUEUE_POLL_INTERVAL_MS = 25;

function nowIso() {
  return new Date().toISOString();
}

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

function replyIsWritable(reply: SseReplyWriter) {
  return !reply.raw.destroyed && !reply.raw.writableEnded;
}

function writeSseEvent(reply: SseReplyWriter, event: string, data: Record<string, unknown>) {
  if (!replyIsWritable(reply)) {
    return;
  }

  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function endReply(reply: SseReplyWriter) {
  if (replyIsWritable(reply)) {
    reply.raw.end();
  }
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

async function runWarmGenerate(
  config: OllamaAdapterConfig,
  fetchImpl: typeof fetch,
  payload: { model: string; keep_alive?: string | number }
) {
  if (config.useStub) {
    return modelWarmResponseSchema.parse({
      status: "warmed",
      ready: true,
      model: payload.model,
      warmedAt: nowIso(),
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
    warmedAt: nowIso(),
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
          requestId: args.requestId,
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
    useStub: env.OLLAMA_USE_STUB === "true",
    redisUrl: env.REDIS_URL ?? "",
    maxParallelRequests: Math.max(1, Number(env.OLLAMA_MAX_PARALLEL_REQUESTS ?? 1)),
    queuePromptAfterMs: Math.max(0, Number(env.OLLAMA_QUEUE_PROMPT_AFTER_MS ?? 12_000)),
    runtimeStatusTtlMs: Math.max(0, Number(env.OLLAMA_RUNTIME_STATUS_TTL_MS ?? 30_000)),
    podInstanceId: env.POD_INSTANCE_ID ?? `ollama-adapter-${randomUUID()}`
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
      fetchedAt: nowIso()
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
    fetchedAt: nowIso()
  });
}

async function fetchResidentModels(config: OllamaAdapterConfig, fetchImpl: typeof fetch) {
  if (config.useStub) {
    return ["llama3.1:8b"];
  }

  const response = await fetchImpl(`${config.ollamaBaseUrl}/api/ps`, {
    headers: {
      "CF-Access-Client-Id": config.cfAccessClientId,
      "CF-Access-Client-Secret": config.cfAccessClientSecret
    }
  });

  if (!response.ok) {
    throw new Error(parseUpstreamErrorMessage(await response.text()) || `Ollama upstream returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };

  return [...new Set((payload.models ?? []).map((model) => model.name ?? model.model ?? "").filter(Boolean))];
}

async function getRuntimeStatus(
  config: OllamaAdapterConfig,
  fetchImpl: typeof fetch,
  coordinationStore: QueueCoordinator,
  runtimeCache: RuntimeCache
) {
  const stats = await coordinationStore.getQueueStats();
  const now = Date.now();
  const shouldUseCache =
    config.runtimeStatusTtlMs > 0 &&
    runtimeCache.fetchedAtMs > 0 &&
    now - runtimeCache.fetchedAtMs <= config.runtimeStatusTtlMs;

  let residentModels = shouldUseCache ? runtimeCache.residentModels : [];
  let fastPathModels = shouldUseCache ? runtimeCache.fastPathModels : [];
  let fetchedAtMs = shouldUseCache ? runtimeCache.fetchedAtMs : now;

  if (!shouldUseCache) {
    try {
      residentModels = await fetchResidentModels(config, fetchImpl);
      fastPathModels = residentModels;
      fetchedAtMs = now;
      runtimeCache.fetchedAtMs = fetchedAtMs;
      runtimeCache.residentModels = residentModels;
      runtimeCache.fastPathModels = fastPathModels;
    } catch {
      residentModels = runtimeCache.residentModels;
      fastPathModels = runtimeCache.fastPathModels;
      fetchedAtMs = runtimeCache.fetchedAtMs || now;
    }
  }

  return ollamaRuntimeSchema.parse({
    busy: stats.activeRequests > 0 || stats.queueDepth > 0,
    activeRequests: stats.activeRequests,
    maxParallelRequests: config.maxParallelRequests,
    queueDepth: stats.queueDepth,
    residentModels,
    fastPathModels,
    fetchedAt: new Date(fetchedAtMs).toISOString()
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function snapshotToQueuedResponse(snapshot: QueueRequestSnapshot) {
  return queuedChatRequestResponseSchema.parse({
    request: {
      requestId: snapshot.requestId,
      state: snapshot.state,
      model: snapshot.model,
      position: snapshot.position,
      queueDepth: snapshot.queueDepth,
      queuedAt: snapshot.queuedAt,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt
    }
  });
}

async function waitForExecutionSlot(args: {
  coordinationStore: QueueCoordinator;
  requestId: string;
  initialModel: string;
  reply: SseReplyWriter;
  config: OllamaAdapterConfig;
  downstreamClosed: () => boolean;
}): Promise<QueueRequestSnapshot | null> {
  const enqueued = await args.coordinationStore.enqueueRequest({
    requestId: args.requestId,
    model: args.initialModel
  });

  let snapshot = await args.coordinationStore.claimRequest(args.requestId, args.config.podInstanceId);

  if (snapshot?.state === "running") {
    return snapshot;
  }

  snapshot ??= enqueued;
  const queuedAtMs = Date.now();
  let lastPosition = snapshot.position;
  let lastQueueDepth = snapshot.queueDepth;
  let prompted = false;

  if (snapshot.state === "queued") {
    writeSseEvent(args.reply, "queued", {
      requestId: args.requestId,
      position: snapshot.position ?? 1,
      queueDepth: snapshot.queueDepth ?? 1,
      model: snapshot.model,
      promptAfterMs: args.config.queuePromptAfterMs
    });
  }

  while (!args.downstreamClosed()) {
    snapshot = await args.coordinationStore.getRequestSnapshot(args.requestId);

    if (!snapshot) {
      return null;
    }

    if (snapshot.state === "running") {
      return snapshot;
    }

    if (snapshot.state === "cancelled") {
      writeSseEvent(args.reply, "done", {
        finishReason: "queued_cancelled"
      });
      endReply(args.reply);
      return null;
    }

    if (snapshot.state === "failed") {
      writeSseEvent(args.reply, "error", {
        requestId: args.requestId,
        model: snapshot.model,
        message: "The queued request failed before execution started."
      });
      endReply(args.reply);
      return null;
    }

    if (snapshot.state !== "queued") {
      return snapshot;
    }

    if (snapshot.position !== lastPosition || snapshot.queueDepth !== lastQueueDepth) {
      lastPosition = snapshot.position;
      lastQueueDepth = snapshot.queueDepth;
      writeSseEvent(args.reply, "queue_update", {
        requestId: args.requestId,
        position: snapshot.position ?? 1,
        queueDepth: snapshot.queueDepth ?? 0
      });
    }

    if (!prompted && Date.now() - queuedAtMs >= args.config.queuePromptAfterMs) {
      prompted = true;
      writeSseEvent(args.reply, "queue_prompt", {
        requestId: args.requestId,
        position: snapshot.position ?? 1,
        waitedMs: Date.now() - queuedAtMs
      });
    }

    const claimed = await args.coordinationStore.claimRequest(args.requestId, args.config.podInstanceId);
    if (claimed?.state === "running") {
      return claimed;
    }

    if (claimed?.state === "cancelled") {
      writeSseEvent(args.reply, "done", {
        finishReason: "queued_cancelled"
      });
      endReply(args.reply);
      return null;
    }

    await sleep(QUEUE_POLL_INTERVAL_MS);
  }

  return null;
}

function emitChunkEvents(reply: SseReplyWriter, chunk: {
  done?: boolean;
  done_reason?: string;
  message?: { content?: string; thinking?: string };
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}) {
  if (chunk.message?.thinking) {
    writeSseEvent(reply, "thinking_delta", {
      text: chunk.message.thinking
    });
  }

  if (chunk.message?.content) {
    writeSseEvent(reply, "response_delta", {
      text: chunk.message.content
    });
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
    writeSseEvent(reply, "done", {
      finishReason: chunk.done_reason ?? "stop"
    });
  }
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = {
    ...loadConfig(),
    ...(options.config ?? {})
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const coordinationStore =
    options.coordinationStore ??
    (config.redisUrl
      ? new RedisQueueCoordinator({
          url: config.redisUrl,
          maxParallelRequests: config.maxParallelRequests
        })
      : new InMemoryQueueCoordinator({
          maxParallelRequests: config.maxParallelRequests
        }));
  const activeRequests = new Map<string, AbortController>();
  const runtimeCache: RuntimeCache = {
    fetchedAtMs: 0,
    residentModels: [],
    fastPathModels: []
  };

  let heartbeatTimer: NodeJS.Timeout | undefined;
  let staleRecoveryTimer: NodeJS.Timeout | undefined;
  let unsubscribeCancels: (() => Promise<void>) | undefined;

  const app = Fastify({
    logger: true
  });

  app.addHook("onReady", async () => {
    await coordinationStore.start();
    await coordinationStore.heartbeat(config.podInstanceId);
    unsubscribeCancels = await coordinationStore.subscribeToCancels((requestId) => {
      activeRequests.get(requestId)?.abort();
    });

    heartbeatTimer = setInterval(() => {
      void coordinationStore.heartbeat(config.podInstanceId);
    }, POD_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    staleRecoveryTimer = setInterval(() => {
      void coordinationStore.cleanupStaleRunningRequests();
    }, STALE_RECOVERY_INTERVAL_MS);
    staleRecoveryTimer.unref?.();
  });

  app.addHook("onClose", async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    if (staleRecoveryTimer) {
      clearInterval(staleRecoveryTimer);
    }

    if (unsubscribeCancels) {
      await unsubscribeCancels();
    }

    await coordinationStore.stop();
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

  app.get("/internal/provider/runtime", async () => getRuntimeStatus(config, fetchImpl, coordinationStore, runtimeCache));

  app.post("/internal/provider/models/warm", async (request) => {
    const payload = modelWarmRequestSchema.parse(request.body ?? {});
    const stats = await coordinationStore.getQueueStats();

    if (stats.queueDepth > 0) {
      return modelWarmResponseSchema.parse({
        status: "skipped_queued",
        model: payload.model,
        ready: false
      });
    }

    if (stats.activeRequests > 0) {
      return modelWarmResponseSchema.parse({
        status: "skipped_busy",
        model: payload.model,
        ready: false
      });
    }

    try {
      const runtime = await getRuntimeStatus(config, fetchImpl, coordinationStore, runtimeCache);

      if (runtime.residentModels.includes(payload.model)) {
        return modelWarmResponseSchema.parse({
          status: "already_resident",
          model: payload.model,
          ready: true
        });
      }
    } catch {
      // Ignore runtime lookup errors and attempt the warm call directly.
    }

    return runWarmGenerate(config, fetchImpl, payload);
  });

  app.patch("/internal/provider/chat/requests/:requestId", async (request, reply) => {
    const requestId = (request.params as { requestId: string }).requestId;
    const patch = queuedChatRequestPatchSchema.parse(request.body ?? {});
    const snapshot = await coordinationStore.updateQueuedRequest(requestId, patch);

    if (!snapshot) {
      return reply.code(404).send({
        message: `Queued request ${requestId} was not found.`
      });
    }

    if (snapshot.state !== "queued") {
      return reply.code(409).send(snapshotToQueuedResponse(snapshot));
    }

    return snapshotToQueuedResponse(snapshot);
  });

  app.post("/internal/provider/chat/stream", async (request, reply) => {
    const payload = (request.body ?? {}) as ChatPayload;
    const requestId = payload.requestId ?? "stub-request";
    const initialModel = payload.model ?? "llama3.1:8b";
    let activeModel = initialModel;
    let downstreamClosed = false;

    reply.header("content-type", "text/event-stream");
    writeSseEvent(reply, "meta", {
      requestId,
      model: initialModel
    });

    if (config.useStub) {
      writeSseEvent(reply, "started", {
        requestId,
        model: initialModel,
        startedAt: nowIso()
      });
      writeSseEvent(reply, "thinking_delta", {
        text: "Thinking..."
      });
      writeSseEvent(reply, "response_delta", {
        text: "Hello there"
      });
      writeSseEvent(reply, "done", {
        finishReason: "stub"
      });
      endReply(reply);
      return reply;
    }

    const abortController = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) {
        downstreamClosed = true;
        abortController.abort();
        void coordinationStore.cancelRequest(requestId);
      }
    });

    try {
      await coordinationStore.heartbeat(config.podInstanceId);

      const executionSnapshot = await waitForExecutionSlot({
        coordinationStore,
        requestId,
        initialModel,
        reply,
        config,
        downstreamClosed: () => downstreamClosed
      });

      if (!executionSnapshot) {
        return reply;
      }

      if (executionSnapshot.state !== "running") {
        writeSseEvent(reply, "error", {
          requestId,
          model: executionSnapshot.model,
          message: "The request did not reach a runnable state."
        });
        endReply(reply);
        return reply;
      }

      activeModel = executionSnapshot.model;
      activeRequests.set(requestId, abortController);
      writeSseEvent(reply, "started", {
        requestId,
        model: activeModel,
        startedAt: executionSnapshot.startedAt ?? nowIso()
      });

      const streamResolution = await resolveChatStreamWithFallbacks({
        config,
        fetchImpl,
        abortSignal: abortController.signal,
        payload: {
          ...payload,
          model: activeModel
        },
        requestId,
        model: activeModel,
        reply
      });

      if (!streamResolution.ok) {
        await coordinationStore.finalizeRequest(requestId, "failed");
        writeSseEvent(reply, "error", {
          requestId,
          model: activeModel,
          message: streamResolution.errorText || `Ollama upstream returned ${streamResolution.status}`,
          status: streamResolution.status
        });
        endReply(reply);
        return reply;
      }

      const upstreamBody = streamResolution.upstream.body;

      if (!upstreamBody) {
        await coordinationStore.finalizeRequest(requestId, "failed");
        writeSseEvent(reply, "error", {
          requestId,
          model: activeModel,
          message: "Ollama upstream did not provide a stream body.",
          status: 502
        });
        endReply(reply);
        return reply;
      }

      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneEmitted = false;

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

          const chunk = JSON.parse(trimmed) as Parameters<typeof emitChunkEvents>[1];
          emitChunkEvents(reply, chunk);

          if (chunk.done) {
            doneEmitted = true;
            await coordinationStore.finalizeRequest(requestId, "completed");
          }
        }
      }

      const remainder = buffer.trim();
      if (remainder) {
        const chunk = JSON.parse(remainder) as Parameters<typeof emitChunkEvents>[1];
        emitChunkEvents(reply, chunk);

        if (chunk.done) {
          doneEmitted = true;
          await coordinationStore.finalizeRequest(requestId, "completed");
        }
      }

      if (!doneEmitted) {
        await coordinationStore.finalizeRequest(requestId, "completed");
        writeSseEvent(reply, "done", {
          finishReason: "stop"
        });
      }

      endReply(reply);
      return reply;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        await coordinationStore.finalizeRequest(requestId, "cancelled");
        if (!downstreamClosed) {
          writeSseEvent(reply, "done", {
            finishReason: "cancelled"
          });
          endReply(reply);
        }
        return reply;
      }

      await coordinationStore.finalizeRequest(requestId, "failed");
      writeSseEvent(reply, "error", {
        requestId,
        model: activeModel,
        message: error instanceof Error ? error.message : "Unknown upstream error"
      });
      endReply(reply);
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
    await coordinationStore.cancelRequest(requestId);

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
