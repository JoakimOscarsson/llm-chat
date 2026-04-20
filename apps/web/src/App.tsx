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
  num_ctx?: number;
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

export function App() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [defaults, setDefaults] = useState<AppDefaults>(fallbackDefaults);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState(fallbackDefaults.systemPrompt);
  const [defaultRequestHistoryCount, setDefaultRequestHistoryCount] = useState(String(fallbackDefaults.requestHistoryCount));
  const [defaultResponseHistoryCount, setDefaultResponseHistoryCount] = useState(String(fallbackDefaults.responseHistoryCount));
  const [defaultTemperature, setDefaultTemperature] = useState(String(fallbackDefaults.options.temperature));
  const [defaultNumCtx, setDefaultNumCtx] = useState(String(fallbackDefaults.options.num_ctx));
  const [defaultStreamThinking, setDefaultStreamThinking] = useState(fallbackDefaults.streamThinking);
  const [defaultsStatus, setDefaultsStatus] = useState("Defaults ready");
  const [overrideSystemPrompt, setOverrideSystemPrompt] = useState("");
  const [overrideRequestHistoryCount, setOverrideRequestHistoryCount] = useState("");
  const [overrideResponseHistoryCount, setOverrideResponseHistoryCount] = useState("");
  const [overrideTemperature, setOverrideTemperature] = useState("");
  const [overrideNumCtx, setOverrideNumCtx] = useState("");
  const [overrideKeepAlive, setOverrideKeepAlive] = useState("");
  const [overrideStatus, setOverrideStatus] = useState("Session inherits app defaults");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveThinking, setLiveThinking] = useState("Ready for the next prompt.");
  const [statusText, setStatusText] = useState("Ready");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);

  const loadModels = async () => {
    const modelsResponse = await fetch(`${apiBaseUrl}/api/models`);
    const modelsPayload = (await modelsResponse.json()) as { models: ModelSummary[] };
    setModels(modelsPayload.models);
    return modelsPayload.models;
  };

  const loadSessionDetail = async (sessionId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}`);
      const payload = (await response.json()) as { session: SessionDetail };
      setActiveSession(payload.session);
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
      setOverrideNumCtx(payload.session.overrides?.num_ctx !== undefined ? String(payload.session.overrides.num_ctx) : "");
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
      const [modelsPayload, sessionsResponse, healthResponse] = await Promise.all([
        loadModels(),
        fetch(`${apiBaseUrl}/api/sessions`),
        fetch(`${apiBaseUrl}/api/health`)
      ]);
      const sessionsPayload = (await sessionsResponse.json()) as { sessions: SessionSummary[] };
      const healthPayload = (await healthResponse.json()) as HealthResponse;

      if (!active) {
        return;
      }

      setSessions(sessionsPayload.sessions);
      setHealth(healthPayload);
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
        setDefaultNumCtx(String(defaultsPayload.defaults.options.num_ctx));
        setDefaultStreamThinking(defaultsPayload.defaults.streamThinking);
      } catch {
        setDefaultsStatus("Using fallback defaults");
      }
    };

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    void loadSessionDetail(selectedSessionId);
  }, [selectedSessionId]);

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
          num_ctx: Number(defaultNumCtx)
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
    const parsedNumCtx = parseOptionalInteger(overrideNumCtx);

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

    if (parsedNumCtx !== undefined) {
      overrides.num_ctx = parsedNumCtx;
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Sessions</p>
          <h1>LLM Chat</h1>
        </div>
        <button className="primary-button" type="button">
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
            <div className="thinking-scroll">{liveThinking}</div>
          </div>
        </section>

        <section className="transcript">
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
        </form>
      </main>

      <aside className="utility-panel">
        <section className="widget">
          <p className="eyebrow">App defaults</p>
          <div className="settings-grid">
            <label className="settings-field">
              <span>System prompt</span>
              <textarea value={defaultSystemPrompt} onChange={(event) => setDefaultSystemPrompt(event.target.value)} rows={5} />
            </label>
            <label className="settings-field">
              <span>Request history</span>
              <input value={defaultRequestHistoryCount} onChange={(event) => setDefaultRequestHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Response history</span>
              <input value={defaultResponseHistoryCount} onChange={(event) => setDefaultResponseHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Temperature</span>
              <input value={defaultTemperature} onChange={(event) => setDefaultTemperature(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Context window</span>
              <input value={defaultNumCtx} onChange={(event) => setDefaultNumCtx(event.target.value)} />
            </label>
            <label className="settings-toggle">
              <input checked={defaultStreamThinking} type="checkbox" onChange={(event) => setDefaultStreamThinking(event.target.checked)} />
              <span>Stream thinking by default</span>
            </label>
          </div>
          <div className="widget-footer">
            <span className="panel-subtitle">{defaultsStatus}</span>
            <button className="secondary-button" type="button" onClick={() => void handleSaveDefaults()}>
              Save defaults
            </button>
          </div>
        </section>

        <section className="widget">
          <p className="eyebrow">Session overrides</p>
          <div className="settings-grid">
            <label className="settings-field">
              <span>System prompt override</span>
              <textarea value={overrideSystemPrompt} onChange={(event) => setOverrideSystemPrompt(event.target.value)} rows={4} />
            </label>
            <label className="settings-field">
              <span>Request history override</span>
              <input value={overrideRequestHistoryCount} onChange={(event) => setOverrideRequestHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Response history override</span>
              <input value={overrideResponseHistoryCount} onChange={(event) => setOverrideResponseHistoryCount(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Temperature override</span>
              <input value={overrideTemperature} onChange={(event) => setOverrideTemperature(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Context override</span>
              <input value={overrideNumCtx} onChange={(event) => setOverrideNumCtx(event.target.value)} />
            </label>
            <label className="settings-field">
              <span>Keep alive override</span>
              <input value={overrideKeepAlive} onChange={(event) => setOverrideKeepAlive(event.target.value)} />
            </label>
          </div>
          <div className="widget-footer">
            <span className="panel-subtitle">{overrideStatus}</span>
            <button className="secondary-button" disabled={!selectedSessionId} type="button" onClick={() => void handleSaveOverrides()}>
              Save session
            </button>
          </div>
        </section>

        <section className="widget">
          <p className="eyebrow">GPU VRAM</p>
          <div className="meter">
            <div className="meter-bar" style={{ width: "68%" }} />
          </div>
          <small>11.2 GB / 16 GB</small>
        </section>
      </aside>
    </div>
  );
}
