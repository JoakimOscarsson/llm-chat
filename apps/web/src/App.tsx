import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

type ModelSummary = {
  name: string;
  modifiedAt: string;
  size: number;
};

type SessionSummary = {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
};

type SessionOverrides = {
  systemPrompt?: string;
  requestHistoryCount?: number;
  responseHistoryCount?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  repeat_penalty?: number;
  seed?: number;
  num_ctx?: number;
  num_predict?: number;
  stop?: string[];
  keep_alive?: string | number;
};

type AppDefaults = {
  systemPrompt: string;
  requestHistoryCount: number;
  responseHistoryCount: number;
  streamThinking: boolean;
  persistSessions: boolean;
  options: {
    temperature: number;
    top_k: number;
    top_p: number;
    repeat_penalty: number;
    seed?: number;
    num_ctx: number;
    num_predict: number;
    stop: string[];
    keep_alive?: string | number;
  };
};

type SessionDetail = {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "system" | "user" | "assistant";
    content: string;
    createdAt: string;
    thinking?: {
      content: string;
      collapsedByDefault: true;
    };
  }>;
  overrides?: SessionOverrides;
};

type HealthResponse = {
  status: string;
  service: string;
  dependencies: {
    chatService: string;
    modelService: string;
    sessionService: string;
    metricsService: string;
  };
};

type MetricsResponse =
  | {
      status: "ok";
      sampledAt: string;
      gpu: {
        usedMb: number;
        totalMb: number;
        utilizationPct: number;
      };
    }
  | {
      status: "stale";
      sampledAt: string;
      reason: string;
      gpu: {
        usedMb: number;
        totalMb: number;
        utilizationPct: number;
      };
    }
  | {
      status: "unavailable";
      sampledAt: string;
      reason: string;
    };

type StreamEventPayload = {
  requestId?: string;
  text?: string;
  finishReason?: string;
  message?: string;
  model?: string;
  status?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  isStreaming?: boolean;
};

const fallbackDefaults: AppDefaults = {
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
    num_predict: 512,
    stop: []
  }
};

function parseEventBlock(eventBlock: string) {
  const lines = eventBlock.split("\n");
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const dataLine = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
  const payload = dataLine ? (JSON.parse(dataLine) as StreamEventPayload) : {};

  return {
    eventName,
    payload
  };
}

function appendToLatestAssistant(
  messages: ChatMessage[],
  update: (message: ChatMessage) => ChatMessage
) {
  const nextMessages = [...messages];
  let assistantIndex = -1;

  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    if (nextMessages[index]?.role === "assistant") {
      assistantIndex = index;
      break;
    }
  }

  if (assistantIndex === -1) {
    return messages;
  }

  nextMessages[assistantIndex] = update(nextMessages[assistantIndex]);
  return nextMessages;
}

function latestAssistantHasThinking(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "assistant") {
      return Boolean(message.thinking?.trim());
    }
  }

  return false;
}

function parseOptionalInteger(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStopSequences(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapSessionMessagesToTranscript(session: SessionDetail): ChatMessage[] {
  return session.messages
    .filter(
      (message): message is SessionDetail["messages"][number] & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      thinking: message.role === "assistant" ? message.thinking?.content : undefined,
      isStreaming: false
    }));
}

function isNearBottom(element: HTMLElement, threshold = 48) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function tooltipHint(label: string, hint: string) {
  return (
    <span className="field-label">
      <span>{label}</span>
      <span aria-label={`${label}: ${hint}`} className="hint-chip" role="note" tabIndex={0} title={hint}>
        i
      </span>
    </span>
  );
}

const settingHints = {
  systemPrompt:
    "Instructions prepended to the conversation. Use this to define tone, formatting, and response behavior for every request.",
  requestHistoryCount:
    "How many recent user turns to include when shaping the next request. Higher values preserve more instruction context.",
  responseHistoryCount:
    "How many recent assistant turns to include alongside the user history. Raise this when you want the model to stay anchored to earlier answers.",
  temperature:
    "Controls randomness. Lower values are steadier and more deterministic; higher values are more creative.",
  topK:
    "Limits token sampling to the top K candidates. Lower values make responses narrower and more conservative.",
  topP:
    "Nucleus sampling threshold. The model samples from the smallest token set whose combined probability reaches this value.",
  repeatPenalty:
    "Discourages repetition. Higher values make the model less likely to loop or repeat prior text.",
  seed:
    "Optional seed for repeatable generations when the model/runtime supports it.",
  numCtx:
    "Maximum context window sent to the model. Larger values preserve more conversation but consume more memory.",
  numPredict:
    "Maximum tokens to generate for the next answer.",
  stop:
    "One stop sequence per line. Generation stops when the model emits any of these strings.",
  keepAlive:
    "Hints how long Ollama should keep the model loaded after the request. Useful when switching models or avoiding reload delays.",
  streamThinking:
    "Requests a separate reasoning stream when the selected model supports it. Unsupported models will fall back automatically."
} as const;

export function App() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [defaults, setDefaults] = useState<AppDefaults>(fallbackDefaults);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState(fallbackDefaults.systemPrompt);
  const [defaultRequestHistoryCount, setDefaultRequestHistoryCount] = useState(String(fallbackDefaults.requestHistoryCount));
  const [defaultResponseHistoryCount, setDefaultResponseHistoryCount] = useState(String(fallbackDefaults.responseHistoryCount));
  const [defaultTemperature, setDefaultTemperature] = useState(String(fallbackDefaults.options.temperature));
  const [defaultTopK, setDefaultTopK] = useState(String(fallbackDefaults.options.top_k));
  const [defaultTopP, setDefaultTopP] = useState(String(fallbackDefaults.options.top_p));
  const [defaultRepeatPenalty, setDefaultRepeatPenalty] = useState(String(fallbackDefaults.options.repeat_penalty));
  const [defaultSeed, setDefaultSeed] = useState(fallbackDefaults.options.seed !== undefined ? String(fallbackDefaults.options.seed) : "");
  const [defaultNumCtx, setDefaultNumCtx] = useState(String(fallbackDefaults.options.num_ctx));
  const [defaultNumPredict, setDefaultNumPredict] = useState(String(fallbackDefaults.options.num_predict));
  const [defaultStop, setDefaultStop] = useState(fallbackDefaults.options.stop.join("\n"));
  const [defaultKeepAlive, setDefaultKeepAlive] = useState(
    fallbackDefaults.options.keep_alive !== undefined ? String(fallbackDefaults.options.keep_alive) : ""
  );
  const [defaultStreamThinking, setDefaultStreamThinking] = useState(fallbackDefaults.streamThinking);
  const [defaultsStatus, setDefaultsStatus] = useState("Defaults ready");
  const [overrideSystemPrompt, setOverrideSystemPrompt] = useState("");
  const [overrideRequestHistoryCount, setOverrideRequestHistoryCount] = useState("");
  const [overrideResponseHistoryCount, setOverrideResponseHistoryCount] = useState("");
  const [overrideTemperature, setOverrideTemperature] = useState("");
  const [overrideTopK, setOverrideTopK] = useState("");
  const [overrideTopP, setOverrideTopP] = useState("");
  const [overrideRepeatPenalty, setOverrideRepeatPenalty] = useState("");
  const [overrideSeed, setOverrideSeed] = useState("");
  const [overrideNumCtx, setOverrideNumCtx] = useState("");
  const [overrideNumPredict, setOverrideNumPredict] = useState("");
  const [overrideStop, setOverrideStop] = useState("");
  const [overrideKeepAlive, setOverrideKeepAlive] = useState("");
  const [overrideStatus, setOverrideStatus] = useState("Session inherits app defaults");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveThinking, setLiveThinking] = useState("Ready for the next prompt.");
  const [statusText, setStatusText] = useState("Ready");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [transcriptPinned, setTranscriptPinned] = useState(true);
  const [thinkingPinned, setThinkingPinned] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const thinkingScrollRef = useRef<HTMLDivElement | null>(null);

  const loadModels = async () => {
    const modelsResponse = await fetch(`${apiBaseUrl}/api/models`);
    const modelsPayload = (await modelsResponse.json()) as { models: ModelSummary[] };
    setModels(modelsPayload.models);
    return modelsPayload.models;
  };

  const loadMetrics = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/metrics/gpu`);
      const payload = (await response.json()) as MetricsResponse;
      setMetrics(payload);
      return payload;
    } catch {
      const fallback: MetricsResponse = {
        status: "unavailable",
        sampledAt: new Date().toISOString(),
        reason: "request_failed"
      };
      setMetrics(fallback);
      return fallback;
    }
  };

  const loadSessionDetail = async (sessionId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}`);
      const payload = (await response.json()) as { session: SessionDetail };
      setActiveSession(payload.session);
      setMessages((current) => (current.length === 0 ? mapSessionMessagesToTranscript(payload.session) : current));
      setSelectedModel(payload.session.model);
      setOverrideSystemPrompt(payload.session.overrides?.systemPrompt ?? "");
      setOverrideRequestHistoryCount(
        payload.session.overrides?.requestHistoryCount !== undefined ? String(payload.session.overrides.requestHistoryCount) : ""
      );
      setOverrideResponseHistoryCount(
        payload.session.overrides?.responseHistoryCount !== undefined ? String(payload.session.overrides.responseHistoryCount) : ""
      );
      setOverrideTemperature(
        payload.session.overrides?.temperature !== undefined ? String(payload.session.overrides.temperature) : ""
      );
      setOverrideTopK(payload.session.overrides?.top_k !== undefined ? String(payload.session.overrides.top_k) : "");
      setOverrideTopP(payload.session.overrides?.top_p !== undefined ? String(payload.session.overrides.top_p) : "");
      setOverrideRepeatPenalty(
        payload.session.overrides?.repeat_penalty !== undefined ? String(payload.session.overrides.repeat_penalty) : ""
      );
      setOverrideSeed(payload.session.overrides?.seed !== undefined ? String(payload.session.overrides.seed) : "");
      setOverrideNumCtx(payload.session.overrides?.num_ctx !== undefined ? String(payload.session.overrides.num_ctx) : "");
      setOverrideNumPredict(
        payload.session.overrides?.num_predict !== undefined ? String(payload.session.overrides.num_predict) : ""
      );
      setOverrideStop(payload.session.overrides?.stop?.join("\n") ?? "");
      setOverrideKeepAlive(
        payload.session.overrides?.keep_alive !== undefined ? String(payload.session.overrides.keep_alive) : ""
      );
      setOverrideStatus(
        payload.session.overrides && Object.keys(payload.session.overrides).length > 0
          ? "Session overrides loaded"
          : "Session inherits app defaults"
      );
    } catch {
      setActiveSession(null);
      setOverrideStatus("Session details unavailable");
    }
  };

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      const [modelsPayload, sessionsResponse, healthResponse, metricsPayload] = await Promise.all([
        loadModels(),
        fetch(`${apiBaseUrl}/api/sessions`),
        fetch(`${apiBaseUrl}/api/health`),
        loadMetrics()
      ]);
      const sessionsPayload = (await sessionsResponse.json()) as { sessions: SessionSummary[] };
      const healthPayload = (await healthResponse.json()) as HealthResponse;

      if (!active) {
        return;
      }

      setSessions(sessionsPayload.sessions);
      setHealth(healthPayload);
      setMetrics(metricsPayload);
      setSelectedSessionId((current) => current ?? sessionsPayload.sessions[0]?.id ?? null);
      setSelectedModel((current) => current || sessionsPayload.sessions[0]?.model || modelsPayload[0]?.name || "");

      try {
        const defaultsResponse = await fetch(`${apiBaseUrl}/api/settings/defaults`);
        const defaultsPayload = (await defaultsResponse.json()) as { defaults: AppDefaults };

        if (!active) {
          return;
        }

        setDefaults(defaultsPayload.defaults);
        setDefaultSystemPrompt(defaultsPayload.defaults.systemPrompt);
        setDefaultRequestHistoryCount(String(defaultsPayload.defaults.requestHistoryCount));
        setDefaultResponseHistoryCount(String(defaultsPayload.defaults.responseHistoryCount));
        setDefaultTemperature(String(defaultsPayload.defaults.options.temperature));
        setDefaultTopK(String(defaultsPayload.defaults.options.top_k));
        setDefaultTopP(String(defaultsPayload.defaults.options.top_p));
        setDefaultRepeatPenalty(String(defaultsPayload.defaults.options.repeat_penalty));
        setDefaultSeed(
          defaultsPayload.defaults.options.seed !== undefined ? String(defaultsPayload.defaults.options.seed) : ""
        );
        setDefaultNumCtx(String(defaultsPayload.defaults.options.num_ctx));
        setDefaultNumPredict(String(defaultsPayload.defaults.options.num_predict));
        setDefaultStop(defaultsPayload.defaults.options.stop.join("\n"));
        setDefaultKeepAlive(
          defaultsPayload.defaults.options.keep_alive !== undefined ? String(defaultsPayload.defaults.options.keep_alive) : ""
        );
        setDefaultStreamThinking(defaultsPayload.defaults.streamThinking);
      } catch {
        setDefaultsStatus("Using fallback defaults");
      }
    };

    void loadData();

    const interval = setInterval(() => {
      if (!active) {
        return;
      }

      void loadMetrics();
    }, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    setMessages([]);
    void loadSessionDetail(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    const transcript = transcriptRef.current;

    if (transcriptPinned && transcript) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [messages, transcriptPinned]);

  useEffect(() => {
    const thinkingPane = thinkingScrollRef.current;

    if (thinkingPinned && thinkingPane) {
      thinkingPane.scrollTop = thinkingPane.scrollHeight;
    }
  }, [liveThinking, thinkingPinned]);

  const handleStreamEvent = (eventName: string | undefined, payload: StreamEventPayload) => {
    if (eventName === "meta" && payload.requestId) {
      setActiveRequestId(payload.requestId);
      setStatusText(`Waiting for ${payload.model ?? selectedModel}...`);
    }

    if (eventName === "thinking_delta") {
      const nextText = payload.text ?? "";
      setStatusText("Streaming reasoning...");
      setLiveThinking((current) => `${current}${nextText}`);
      setMessages((current) =>
        appendToLatestAssistant(current, (message) => ({
          ...message,
          thinking: `${message.thinking ?? ""}${nextText}`
        }))
      );
    }

    if (eventName === "response_delta") {
      const nextText = payload.text ?? "";
      setStatusText("Streaming answer...");
      setLiveThinking((current) =>
        current === "Connecting to model..." || current.startsWith("Waiting for ")
          ? "This model does not stream a separate thinking trace."
          : current
      );
      setMessages((current) => {
        const nextMessages = appendToLatestAssistant(current, (message) => ({
          ...message,
          content: `${message.content}${nextText}`
        }));

        if (latestAssistantHasThinking(nextMessages)) {
          return nextMessages;
        }

        return appendToLatestAssistant(nextMessages, (message) => ({
          ...message,
          thinking: message.thinking?.trim() ? message.thinking : "This model does not stream a separate thinking trace."
        }));
      });
    }

    if (eventName === "thinking_unavailable") {
      const notice = payload.text ?? "This model does not stream a separate thinking trace.";
      setLiveThinking(notice);
      setStatusText("Streaming answer...");
      setMessages((current) =>
        appendToLatestAssistant(current, (message) => ({
          ...message,
          thinking: message.thinking?.trim() ? message.thinking : notice
        }))
      );
    }

    if (eventName === "settings_notice") {
      const notice = payload.text ?? "One or more settings are unsupported for this model. Retrying without them.";
      setLiveThinking(notice);
      setStatusText("Retrying with supported settings...");
    }

    if (eventName === "error") {
      const errorMessage = payload.message ?? "Unknown upstream error";
      const errorModel = payload.model ?? selectedModel;
      setLiveThinking(errorMessage);
      setStatusText("Request failed");
      setMessages((current) =>
        appendToLatestAssistant(current, (message) => ({
          ...message,
          isStreaming: false,
          content:
            message.content ||
            `Request failed while using \`${errorModel}\`.\n\n${errorMessage}`
        }))
      );
    }

    if (eventName === "done") {
      setStatusText(payload.finishReason === "aborted" ? "Stopped" : "Complete");
      setMessages((current) =>
        appendToLatestAssistant(current, (message) => ({
          ...message,
          isStreaming: false
        }))
      );
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const messageText = prompt.trim();
    if (!messageText) {
      return;
    }

    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const abortController = new AbortController();
    let buffer = "";

    setPrompt("");
    setLiveThinking("Connecting to model...");
    setStatusText(`Sending prompt to ${selectedModel}...`);
    setIsStreaming(true);
    setActiveRequestId(requestId);
    setMessages((current) => [
      ...current,
      {
        id: `${requestId}-user`,
        role: "user",
        content: messageText
      },
      {
        id: `${requestId}-assistant`,
        role: "assistant",
        content: "",
        thinking: "",
        isStreaming: true
      }
    ]);
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          requestId,
          sessionId: selectedSessionId ?? undefined,
          model: selectedModel,
          message: messageText
        }),
        signal: abortController.signal
      });

      if (!response.body) {
        const text = await response.text();
        const events = text.split("\n\n").filter(Boolean);

        for (const eventBlock of events) {
          const { eventName, payload } = parseEventBlock(eventBlock);
          handleStreamEvent(eventName, payload);
        }

        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      streamReaderRef.current = reader;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const eventBlocks = buffer.split("\n\n");
        buffer = eventBlocks.pop() ?? "";

        for (const eventBlock of eventBlocks) {
          const { eventName, payload } = parseEventBlock(eventBlock);
          handleStreamEvent(eventName, payload);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const { eventName, payload } = parseEventBlock(buffer);
        handleStreamEvent(eventName, payload);
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setLiveThinking("Stream interrupted.");
        setStatusText("Connection interrupted");
        setMessages((current) =>
          appendToLatestAssistant(current, (message) => ({
            ...message,
            isStreaming: false
          }))
        );
      }
    } finally {
      streamReaderRef.current = null;
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleStop = async () => {
    const requestId = activeRequestId;

    abortControllerRef.current?.abort();
    await streamReaderRef.current?.cancel();
    streamReaderRef.current = null;
    abortControllerRef.current = null;
    setLiveThinking("Generation stopped.");
    setStatusText("Stopped");
    setMessages((current) =>
      appendToLatestAssistant(current, (message) => ({
        ...message,
        isStreaming: false
      }))
    );
    setIsStreaming(false);

    if (!requestId) {
      return;
    }

    await fetch(`${apiBaseUrl}/api/chat/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ requestId })
    });
  };

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      setPrompt((current) => `${current}\n`);
      return;
    }

    event.preventDefault();
    composerFormRef.current?.requestSubmit();
  };

  const handleRefreshModels = async () => {
    const refreshedModels = await loadModels();
    setSelectedModel((current) => current || refreshedModels[0]?.name || "");
  };

  const handleCreateSession = async () => {
    const model = selectedModel || models[0]?.name;

    if (!model) {
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "New chat",
        model
      })
    });
    const payload = (await response.json()) as { session: SessionDetail };

    setSessions((current) => [
      {
        id: payload.session.id,
        title: payload.session.title,
        model: payload.session.model,
        updatedAt: payload.session.updatedAt
      },
      ...current
    ]);
    setSelectedSessionId(payload.session.id);
    setActiveSession(payload.session);
    setSelectedModel(payload.session.model);
    setMessages([]);
    setPrompt("");
    setLiveThinking("Ready for the next prompt.");
    setStatusText("New session ready");
  };

  const handleSaveDefaults = async () => {
    setDefaultsStatus("Saving defaults...");

    const payload = {
      defaults: {
        ...defaults,
        systemPrompt: defaultSystemPrompt,
        requestHistoryCount: Number(defaultRequestHistoryCount),
        responseHistoryCount: Number(defaultResponseHistoryCount),
        streamThinking: defaultStreamThinking,
        options: {
          ...defaults.options,
          temperature: Number(defaultTemperature),
          top_k: Number(defaultTopK),
          top_p: Number(defaultTopP),
          repeat_penalty: Number(defaultRepeatPenalty),
          ...(parseOptionalInteger(defaultSeed) !== undefined ? { seed: parseOptionalInteger(defaultSeed) } : {}),
          num_ctx: Number(defaultNumCtx),
          num_predict: Number(defaultNumPredict),
          stop: parseStopSequences(defaultStop),
          ...(defaultKeepAlive.trim() ? { keep_alive: defaultKeepAlive } : {})
        }
      }
    };

    const response = await fetch(`${apiBaseUrl}/api/settings/defaults`, {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const responsePayload = (await response.json()) as { defaults: AppDefaults };

    setDefaults(responsePayload.defaults);
    setDefaultsStatus("Defaults saved");
  };

  const handleSaveOverrides = async () => {
    if (!selectedSessionId) {
      return;
    }

    setOverrideStatus("Saving session overrides...");

    const overrides: SessionOverrides = {};
    const parsedRequestHistoryCount = parseOptionalInteger(overrideRequestHistoryCount);
    const parsedResponseHistoryCount = parseOptionalInteger(overrideResponseHistoryCount);
    const parsedTemperature = parseOptionalNumber(overrideTemperature);
    const parsedTopK = parseOptionalInteger(overrideTopK);
    const parsedTopP = parseOptionalNumber(overrideTopP);
    const parsedRepeatPenalty = parseOptionalNumber(overrideRepeatPenalty);
    const parsedSeed = parseOptionalInteger(overrideSeed);
    const parsedNumCtx = parseOptionalInteger(overrideNumCtx);
    const parsedNumPredict = parseOptionalInteger(overrideNumPredict);

    if (overrideSystemPrompt.trim()) {
      overrides.systemPrompt = overrideSystemPrompt;
    }

    if (parsedRequestHistoryCount !== undefined) {
      overrides.requestHistoryCount = parsedRequestHistoryCount;
    }

    if (parsedResponseHistoryCount !== undefined) {
      overrides.responseHistoryCount = parsedResponseHistoryCount;
    }

    if (parsedTemperature !== undefined) {
      overrides.temperature = parsedTemperature;
    }

    if (parsedTopK !== undefined) {
      overrides.top_k = parsedTopK;
    }

    if (parsedTopP !== undefined) {
      overrides.top_p = parsedTopP;
    }

    if (parsedRepeatPenalty !== undefined) {
      overrides.repeat_penalty = parsedRepeatPenalty;
    }

    if (parsedSeed !== undefined) {
      overrides.seed = parsedSeed;
    }

    if (parsedNumCtx !== undefined) {
      overrides.num_ctx = parsedNumCtx;
    }

    if (parsedNumPredict !== undefined) {
      overrides.num_predict = parsedNumPredict;
    }

    const parsedStop = parseStopSequences(overrideStop);
    if (parsedStop.length > 0) {
      overrides.stop = parsedStop;
    }

    if (overrideKeepAlive.trim()) {
      overrides.keep_alive = overrideKeepAlive;
    }

    const response = await fetch(`${apiBaseUrl}/api/sessions/${selectedSessionId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        overrides
      })
    });
    const payload = (await response.json()) as { session: SessionDetail };

    setActiveSession(payload.session);
    setOverrideStatus(Object.keys(overrides).length > 0 ? "Session overrides saved" : "Session inherits app defaults");
    setSessions((current) =>
      current.map((session) =>
        session.id === payload.session.id
          ? {
              ...session,
              title: payload.session.title,
              model: payload.session.model,
              updatedAt: payload.session.updatedAt
            }
          : session
      )
    );
  };

  const handleClearHistory = async () => {
    if (!selectedSessionId || isStreaming) {
      return;
    }

    setStatusText("Clearing history...");
    setLiveThinking("Resetting the active conversation.");

    const response = await fetch(`${apiBaseUrl}/api/sessions/${selectedSessionId}/history`, {
      method: "DELETE"
    });
    const payload = (await response.json()) as { session: SessionDetail };

    setActiveSession(payload.session);
    setMessages([]);
    setPrompt("");
    setLiveThinking("Ready for the next prompt.");
    setStatusText("History cleared");
    setActiveRequestId(null);
    setSessions((current) =>
      current.map((session) =>
        session.id === payload.session.id
          ? {
              ...session,
              updatedAt: payload.session.updatedAt
            }
          : session
      )
    );
  };

  const handleTranscriptScroll = () => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    setTranscriptPinned(isNearBottom(transcript));
  };

  const handleThinkingScroll = () => {
    const thinkingPane = thinkingScrollRef.current;

    if (!thinkingPane) {
      return;
    }

    setThinkingPinned(isNearBottom(thinkingPane));
  };

  const metricsAvailability =
    metrics?.status === "ok" || metrics?.status === "stale"
      ? `${metrics.gpu.usedMb.toFixed(0)} MB / ${metrics.gpu.totalMb.toFixed(0)} MB`
      : "Metrics unavailable";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Sessions</p>
          <h1>LLM Chat</h1>
        </div>
        <button className="primary-button" type="button" onClick={() => void handleCreateSession()}>
          New session
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              aria-pressed={selectedSessionId === session.id}
              className="session-card"
              key={session.id}
              type="button"
              onClick={() => setSelectedSessionId(session.id)}
            >
              <span>{session.title}</span>
              <small>{session.updatedAt}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Active model</p>
            <h2>{selectedModel || "Loading models..."}</h2>
          </div>
          <div className="header-actions">
            <label className="model-select-label">
              <span className="eyebrow">Model selector</span>
              <select
                aria-label="Model selector"
                className="model-select"
                onChange={(event) => setSelectedModel(event.target.value)}
                value={selectedModel}
              >
                {models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => void handleRefreshModels()}>
              Refresh models
            </button>
          </div>
        </header>

        <section className="thinking-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Live thinking</p>
              <p className="panel-subtitle">Visible while the model reasons, saved collapsed in history.</p>
            </div>
            <span className={`status-pill ${isStreaming ? "working" : "muted"}`}>{statusText}</span>
          </div>
          <div className="thinking-box" role="status" aria-live="polite">
            <div className="thinking-scroll" onScroll={handleThinkingScroll} ref={thinkingScrollRef}>
              {liveThinking}
            </div>
          </div>
        </section>

        <section className="transcript" onScroll={handleTranscriptScroll} ref={transcriptRef}>
          {messages.length === 0 ? (
            <article className="message empty-state">
              <p className="eyebrow">Transcript</p>
              <p>Pick a model, send a prompt, and the conversation will build here.</p>
            </article>
          ) : null}
          {messages.map((message) => (
            <article className={`message ${message.role}-message`} key={message.id}>
              {message.role === "assistant" && message.thinking ? (
                <details>
                  <summary>{message.isStreaming ? "Thinking trace (live)" : "Thinking trace"}</summary>
                  <div className="thinking-trace">{message.thinking}</div>
                </details>
              ) : null}
              {message.role === "assistant" ? (
                <div className="markdown-body">
                  {message.content ? <ReactMarkdown>{message.content}</ReactMarkdown> : <p className="pending-copy">Waiting for answer...</p>}
                </div>
              ) : (
                <p>{message.content}</p>
              )}
            </article>
          ))}
        </section>

        <form className="composer" onSubmit={handleSubmit} ref={composerFormRef}>
          <textarea
            aria-label="Prompt"
            className="composer-input"
            placeholder="Send a message to the model..."
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
          />
          <div className="composer-actions">
            <div className="status-line">
              <span className="status-pill">
                {health?.status === "ok" ? "Gateway ready" : "Gateway degraded"}
              </span>
              <span className="status-pill muted">
                {health?.dependencies.metricsService === "ok" ? "Metrics ready" : "Metrics degraded"}
              </span>
            </div>
            <div className="composer-button-row">
              <button className="secondary-button" disabled={!selectedSessionId || isStreaming} type="button" onClick={() => void handleClearHistory()}>
                Clear history
              </button>
              {isStreaming ? (
                <button className="primary-button" type="button" onClick={handleStop}>
                  Stop
                </button>
              ) : (
                <button className="primary-button" type="submit">
                  Send
                </button>
              )}
            </div>
          </div>
        </form>
      </main>

      <aside className="utility-panel">
        <details className="widget disclosure">
          <summary className="widget-summary">
            <div>
              <p className="eyebrow">App defaults</p>
              <p className="panel-subtitle">Global baseline for new chats.</p>
            </div>
            <span className="summary-state">{defaultsStatus}</span>
          </summary>
          <div className="settings-grid">
            <label className="settings-field">
              {tooltipHint("System prompt", settingHints.systemPrompt)}
              <textarea aria-label="System prompt" value={defaultSystemPrompt} onChange={(event) => setDefaultSystemPrompt(event.target.value)} rows={5} />
            </label>
            <label className="settings-field">
              {tooltipHint("Request history", settingHints.requestHistoryCount)}
              <input aria-label="Request history" value={defaultRequestHistoryCount} onChange={(event) => setDefaultRequestHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Response history", settingHints.responseHistoryCount)}
              <input aria-label="Response history" value={defaultResponseHistoryCount} onChange={(event) => setDefaultResponseHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Temperature", settingHints.temperature)}
              <input aria-label="Temperature" value={defaultTemperature} onChange={(event) => setDefaultTemperature(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Top K", settingHints.topK)}
              <input aria-label="Top K" value={defaultTopK} onChange={(event) => setDefaultTopK(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Top P", settingHints.topP)}
              <input aria-label="Top P" value={defaultTopP} onChange={(event) => setDefaultTopP(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Repeat penalty", settingHints.repeatPenalty)}
              <input aria-label="Repeat penalty" value={defaultRepeatPenalty} onChange={(event) => setDefaultRepeatPenalty(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Seed", settingHints.seed)}
              <input aria-label="Seed" value={defaultSeed} onChange={(event) => setDefaultSeed(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Context window", settingHints.numCtx)}
              <input aria-label="Context window" value={defaultNumCtx} onChange={(event) => setDefaultNumCtx(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Max tokens", settingHints.numPredict)}
              <input aria-label="Max tokens" value={defaultNumPredict} onChange={(event) => setDefaultNumPredict(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Stop sequences", settingHints.stop)}
              <textarea aria-label="Stop sequences" value={defaultStop} onChange={(event) => setDefaultStop(event.target.value)} rows={3} />
            </label>
            <label className="settings-field">
              {tooltipHint("Keep alive", settingHints.keepAlive)}
              <input aria-label="Keep alive" value={defaultKeepAlive} onChange={(event) => setDefaultKeepAlive(event.target.value)} />
            </label>
            <label className="settings-toggle">
              <input checked={defaultStreamThinking} type="checkbox" onChange={(event) => setDefaultStreamThinking(event.target.checked)} />
              {tooltipHint("Stream thinking by default", settingHints.streamThinking)}
            </label>
          </div>
          <div className="widget-footer">
            <button className="secondary-button" type="button" onClick={() => void handleSaveDefaults()}>
              Save defaults
            </button>
          </div>
        </details>

        <details className="widget disclosure">
          <summary className="widget-summary">
            <div>
              <p className="eyebrow">Session overrides</p>
              <p className="panel-subtitle">Per-chat adjustments on top of app defaults.</p>
            </div>
            <span className="summary-state">{overrideStatus}</span>
          </summary>
          <div className="settings-grid">
            <label className="settings-field">
              {tooltipHint("System prompt override", settingHints.systemPrompt)}
              <textarea aria-label="System prompt override" value={overrideSystemPrompt} onChange={(event) => setOverrideSystemPrompt(event.target.value)} rows={4} />
            </label>
            <label className="settings-field">
              {tooltipHint("Request history override", settingHints.requestHistoryCount)}
              <input aria-label="Request history override" value={overrideRequestHistoryCount} onChange={(event) => setOverrideRequestHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Response history override", settingHints.responseHistoryCount)}
              <input aria-label="Response history override" value={overrideResponseHistoryCount} onChange={(event) => setOverrideResponseHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Temperature override", settingHints.temperature)}
              <input aria-label="Temperature override" value={overrideTemperature} onChange={(event) => setOverrideTemperature(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Top K override", settingHints.topK)}
              <input aria-label="Top K override" value={overrideTopK} onChange={(event) => setOverrideTopK(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Top P override", settingHints.topP)}
              <input aria-label="Top P override" value={overrideTopP} onChange={(event) => setOverrideTopP(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Repeat penalty override", settingHints.repeatPenalty)}
              <input aria-label="Repeat penalty override" value={overrideRepeatPenalty} onChange={(event) => setOverrideRepeatPenalty(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Seed override", settingHints.seed)}
              <input aria-label="Seed override" value={overrideSeed} onChange={(event) => setOverrideSeed(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Context override", settingHints.numCtx)}
              <input aria-label="Context override" value={overrideNumCtx} onChange={(event) => setOverrideNumCtx(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Max tokens override", settingHints.numPredict)}
              <input aria-label="Max tokens override" value={overrideNumPredict} onChange={(event) => setOverrideNumPredict(event.target.value)} />
            </label>
            <label className="settings-field">
              {tooltipHint("Stop override", settingHints.stop)}
              <textarea aria-label="Stop override" value={overrideStop} onChange={(event) => setOverrideStop(event.target.value)} rows={3} />
            </label>
            <label className="settings-field">
              {tooltipHint("Keep alive override", settingHints.keepAlive)}
              <input aria-label="Keep alive override" value={overrideKeepAlive} onChange={(event) => setOverrideKeepAlive(event.target.value)} />
            </label>
          </div>
          <div className="widget-footer">
            <button className="secondary-button" disabled={!selectedSessionId} type="button" onClick={() => void handleSaveOverrides()}>
              Save session
            </button>
          </div>
        </details>

        <details className="widget disclosure" open>
          <summary className="widget-summary">
            <div>
              <p className="eyebrow">System status</p>
              <p className="panel-subtitle">Connection and VRAM availability.</p>
            </div>
            <span className="summary-state">{metricsAvailability}</span>
          </summary>
          <div className="diagnostics-grid">
            <div className="status-line">
              <span className="status-pill">{health?.status === "ok" ? "Gateway ready" : "Gateway degraded"}</span>
              <span className={`status-pill ${metrics?.status === "ok" ? "" : "muted"}`}>
                {metrics?.status === "ok" ? "Metrics current" : metrics?.status === "stale" ? "Metrics stale" : "Metrics unavailable"}
              </span>
            </div>
            <div className="meter">
              <div
                className={`meter-bar ${metrics?.status === "stale" ? "stale" : ""}`}
                style={{
                  width:
                    metrics?.status === "ok" || metrics?.status === "stale"
                      ? `${Math.min(100, Math.max(0, metrics.gpu.utilizationPct))}%`
                      : "0%"
                }}
              />
            </div>
            {metrics?.status === "ok" || metrics?.status === "stale" ? (
              <>
                <small>{metricsAvailability}</small>
                <small className="panel-subtitle">
                  {metrics.status === "stale" ? "Metrics are stale" : "Metrics are current"} · sampled {metrics.sampledAt}
                </small>
              </>
            ) : (
              <>
                <small>{metricsAvailability}</small>
                <small className="panel-subtitle">Reason: {metrics?.reason ?? "loading"}</small>
              </>
            )}
            <button className="secondary-button" type="button" onClick={() => void loadMetrics()}>
              Refresh metrics
            </button>
          </div>
        </details>
      </aside>
    </div>
  );
}
