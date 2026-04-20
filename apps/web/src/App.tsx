import { useEffect, useState } from "react";

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

export function App() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);

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
          <div className="thinking-box">Waiting for stream events...</div>
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
        </section>

        <form className="composer">
          <textarea
            aria-label="Prompt"
            className="composer-input"
            placeholder="Send a message to the model..."
            rows={6}
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
            <button className="primary-button" type="submit">
              Send
            </button>
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
