CREATE TABLE IF NOT EXISTS app_defaults (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS session_seq START WITH 2 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT ('sess_' || nextval('session_seq')::text),
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  kind TEXT,
  model TEXT,
  content TEXT NOT NULL,
  thinking JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_updated_at_desc_idx ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS session_messages_session_created_idx ON session_messages(session_id, created_at, id);
