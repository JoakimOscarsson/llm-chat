const sessions = [
  { id: "sess_1", title: "New chat", updatedAt: "Just now" }
];

const models = ["llama3.1:8b"];

export function App() {
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
            <h2>{models[0]}</h2>
          </div>
          <div className="header-actions">
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
              <span className="status-pill">Gateway ready</span>
              <span className="status-pill muted">Metrics unavailable</span>
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

