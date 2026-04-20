import { useEffect, useRef, useState } from "react";

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

export function App() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [prompt, setPrompt] = useState("");
  const [liveThinking, setLiveThinking] = useState("Waiting for stream events...");
  const [assistantResponse, setAssistantResponse] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      const [modelsResponse, sessionsResponse, healthResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/models`),
        fetch(`${apiBaseUrl}/api/sessions`),
        fetch(`${apiBaseUrl}/api/health`)
      ]);
      const modelsPayload = (await modelsResponse.json()) as { models: ModelSummary[] };
      const sessionsPayload = (await sessionsResponse.json()) as { sessions: SessionSummary[] };
      const healthPayload = (await healthResponse.json()) as HealthResponse;

      if (!active) {
        return;
      }

      setModels(modelsPayload.models);
      setSessions(sessionsPayload.sessions);
      setHealth(healthPayload);
      setSelectedModel((current) => current || modelsPayload.models[0]?.name || "");
    };

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  const handleStreamEvent = (eventName: string | undefined, payload: StreamEventPayload) => {
    if (eventName === "meta" && payload.requestId) {
      setActiveRequestId(payload.requestId);
    }

    if (eventName === "thinking_delta") {
      setLiveThinking((current) => `${current}${payload.text ?? ""}`);
    }

    if (eventName === "response_delta") {
      setAssistantResponse((current) => `${current}${payload.text ?? ""}`);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!prompt.trim()) {
      return;
    }

    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const abortController = new AbortController();
    let buffer = "";

    setLiveThinking("");
    setAssistantResponse("");
    setIsStreaming(true);
    setActiveRequestId(requestId);
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          requestId,
          model: selectedModel,
          message: prompt
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
      const nextValue = `${prompt}\n`;
      setPrompt(nextValue);
      return;
    }

    event.preventDefault();
    composerFormRef.current?.requestSubmit();
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
            <button className="session-card" key={session.id} type="button">
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
            <button className="secondary-button" type="button">
              Refresh models
            </button>
            <button className="secondary-button" type="button">
              Session overrides
            </button>
          </div>
        </header>

        <section className="thinking-panel">
          <p className="eyebrow">Live thinking</p>
          <div className="thinking-box">{liveThinking || "Waiting for stream events..."}</div>
        </section>

        <section className="transcript">
          <article className="message user-message">
            <p>How should this chat app be structured?</p>
          </article>
          <article className="message assistant-message">
            <details>
              <summary>Thinking trace</summary>
              <p>Start with service boundaries, then define contracts.</p>
            </details>
            <p>
              Start with a gateway, a chat service, a session service, a model
              service, a metrics service, and an Ollama adapter.
            </p>
          </article>
          {assistantResponse ? (
            <article className="message assistant-message">
              <details>
                <summary>Thinking trace</summary>
                <p>{liveThinking}</p>
              </details>
              <p>{assistantResponse}</p>
            </article>
          ) : null}
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
          <p className="eyebrow">Defaults</p>
          <ul>
            <li>System prompt enabled</li>
            <li>Request history: 8</li>
            <li>Response history: 8</li>
            <li>Temperature: 0.7</li>
          </ul>
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
