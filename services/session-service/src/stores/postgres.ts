import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appDefaultsSchema, type AppDefaults, type SessionOverrides } from "@llm-chat-app/contracts";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { createdSessionNow, fixedNow, initialDefaults, initialSession } from "../defaults.js";
import type { SessionMessage, SessionRecord, SessionStore } from "../store.js";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const initRetryDelayMs = 500;
const initRetryAttempts = 12;

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function isRelationAlreadyExistsError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    ("code" in error && (error as { code?: string }).code === "42P07") ||
    error.message.toLowerCase().includes("already exists")
  );
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

function isRetryableInitError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error.message.toLowerCase();

  return (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    code === "57P03" ||
    code === "ETIMEDOUT" ||
    message.includes("getaddrinfo enotfound") ||
    message.includes("connection refused") ||
    message.includes("the database system is starting up") ||
    message.includes("timeout")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withInitRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= initRetryAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableInitError(error) || attempt === initRetryAttempts) {
        throw error;
      }

      console.warn(
        `[session-service] Postgres init attempt ${attempt}/${initRetryAttempts} failed, retrying in ${initRetryDelayMs}ms`,
        error
      );
      await sleep(initRetryDelayMs);
    }
  }

  throw lastError;
}

function mapMessageRow(row: {
  id: string;
  role: "system" | "user" | "assistant";
  kind: "message" | "model_switch" | null;
  model: string | null;
  content: string;
  thinking: unknown;
  created_at: Date | string;
}): SessionMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: toIsoString(row.created_at),
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.thinking ? { thinking: parseJsonValue(row.thinking, undefined) } : {})
  };
}

async function loadSession(pool: Pool, sessionId: string): Promise<SessionRecord | null> {
  const sessionResult = await pool.query<{
    id: string;
    title: string;
    model: string;
    created_at: Date | string;
    updated_at: Date | string;
    overrides: unknown;
  }>(
    `SELECT id, title, model, created_at, updated_at, overrides
       FROM sessions
      WHERE id = $1`,
    [sessionId]
  );

  const sessionRow = sessionResult.rows[0];

  if (!sessionRow) {
    return null;
  }

  const messageResult = await pool.query<{
    id: string;
    role: "system" | "user" | "assistant";
    kind: "message" | "model_switch" | null;
    model: string | null;
    content: string;
    thinking: unknown;
    created_at: Date | string;
  }>(
    `SELECT id, role, kind, model, content, thinking, created_at
       FROM session_messages
      WHERE session_id = $1
   ORDER BY created_at ASC, id ASC`,
    [sessionId]
  );

  return {
    id: sessionRow.id,
    title: sessionRow.title,
    model: sessionRow.model,
    createdAt: toIsoString(sessionRow.created_at),
    updatedAt: toIsoString(sessionRow.updated_at),
    overrides: parseJsonValue<SessionOverrides>(sessionRow.overrides, {}),
    messages: messageResult.rows.map(mapMessageRow)
  };
}

export async function applyMigrations(queryable: Queryable) {
  const migrationsTableExists = await queryable.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'session_service_migrations'
      ) AS exists
    `
  );

  if (!migrationsTableExists.rows[0]?.exists) {
    try {
      await queryable.query(`
        CREATE TABLE session_service_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } catch (error) {
      if (!isRelationAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  const appliedResult = await queryable.query<{ version: string }>(
    `SELECT version FROM session_service_migrations ORDER BY version ASC`
  );
  const applied = new Set(appliedResult.rows.map((row) => row.version));
  const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  for (const filename of filenames) {
    if (applied.has(filename)) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    await queryable.query(sql);
    await queryable.query(`INSERT INTO session_service_migrations (version) VALUES ($1)`, [filename]);
  }
}

export function createPostgresSessionStore(config: { connectionString: string } | { pool: Pool }): SessionStore {
  const pool =
    "pool" in config
      ? config.pool
      : new Pool({
          connectionString: config.connectionString
        } satisfies PoolConfig);

  const ownsPool = !("pool" in config);
  let initPromise: Promise<void> | null = null;

  return {
    async init() {
      if (!initPromise) {
        initPromise = withInitRetry(async () => {
          await applyMigrations(pool);
          await pool.query(
            `INSERT INTO app_defaults (id, payload, updated_at)
             VALUES ('global', $1::jsonb, $2::timestamptz)
             ON CONFLICT (id) DO NOTHING`,
            [JSON.stringify(appDefaultsSchema.parse(initialDefaults)), fixedNow]
          );
          await pool.query(
            `INSERT INTO sessions (id, title, model, created_at, updated_at, overrides)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (id) DO NOTHING`,
            [initialSession.id, initialSession.title, initialSession.model, initialSession.createdAt, initialSession.updatedAt, JSON.stringify({})]
          );
        }).catch((error) => {
          initPromise = null;
          throw error;
        });
      }

      await initPromise;
    },
    async close() {
      if (ownsPool) {
        await pool.end();
      }
    },
    async getDefaults() {
      const result = await pool.query<{ payload: unknown }>(`SELECT payload FROM app_defaults WHERE id = 'global' LIMIT 1`);
      return appDefaultsSchema.parse(parseJsonValue<AppDefaults>(result.rows[0]?.payload, initialDefaults));
    },
    async setDefaults(defaults) {
      const parsed = appDefaultsSchema.parse(defaults);
      await pool.query(
        `INSERT INTO app_defaults (id, payload, updated_at)
         VALUES ('global', $1::jsonb, $2::timestamptz)
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(parsed), fixedNow]
      );
      return parsed;
    },
    async listSessions() {
      const result = await pool.query<{
        id: string;
        title: string;
        model: string;
        updated_at: Date | string;
      }>(
        `SELECT id, title, model, updated_at
           FROM sessions
       ORDER BY updated_at DESC, id ASC`
      );

      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        model: row.model,
        updatedAt: toIsoString(row.updated_at)
      }));
    },
    async createSession(input) {
      const createdAt = input.createdAt || createdSessionNow;
      const result = await pool.query<{
        id: string;
        title: string;
        model: string;
        created_at: Date | string;
        updated_at: Date | string;
        overrides: unknown;
      }>(
        `INSERT INTO sessions (id, title, model, created_at, updated_at, overrides)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, title, model, created_at, updated_at, overrides`,
        [`sess_${randomUUID()}`, input.title, input.model, createdAt, createdAt, JSON.stringify({})]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        title: row.title,
        model: row.model,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
        messages: [],
        overrides: parseJsonValue<SessionOverrides>(row.overrides, {})
      };
    },
    async getSession(sessionId) {
      return loadSession(pool, sessionId);
    },
    async updateSession(sessionId, patch) {
      const result = await pool.query(
        `UPDATE sessions
            SET title = COALESCE($2, title),
                model = COALESCE($3, model),
                overrides = CASE WHEN $4::jsonb IS NULL THEN overrides ELSE $4::jsonb END,
                updated_at = $5::timestamptz
          WHERE id = $1
      RETURNING id`,
        [sessionId, patch.title ?? null, patch.model ?? null, patch.overrides === undefined ? null : JSON.stringify(patch.overrides), patch.updatedAt]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return loadSession(pool, sessionId);
    },
    async appendModelSwitch(sessionId, input) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const updateResult = await client.query(`UPDATE sessions SET model = $2, updated_at = $3::timestamptz WHERE id = $1`, [
          sessionId,
          input.model,
          input.createdAt
        ]);

        if (updateResult.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(
          `INSERT INTO session_messages (id, session_id, role, kind, model, content, thinking, created_at)
           VALUES ($1, $2, 'system', 'model_switch', $3, '', NULL, $4::timestamptz)`,
          [`switch_${sessionId}_${input.createdAt}`, sessionId, input.model, input.createdAt]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return loadSession(pool, sessionId);
    },
    async appendMessage(sessionId, message) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const updateResult = await client.query(`UPDATE sessions SET updated_at = $2::timestamptz WHERE id = $1`, [
          sessionId,
          message.createdAt
        ]);

        if (updateResult.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(
          `INSERT INTO session_messages (id, session_id, role, kind, model, content, thinking, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
          [
            message.id,
            sessionId,
            message.role,
            message.kind ?? null,
            message.model ?? null,
            message.content,
            message.thinking ? JSON.stringify(message.thinking) : null,
            message.createdAt
          ]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return loadSession(pool, sessionId);
    },
    async appendAssistantResult(sessionId, input) {
      return this.appendMessage(sessionId, input.thinking ? { ...input.message, thinking: input.thinking } : input.message);
    },
    async clearHistory(sessionId, updatedAt) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const updateResult = await client.query(`UPDATE sessions SET updated_at = $2::timestamptz WHERE id = $1`, [
          sessionId,
          updatedAt
        ]);

        if (updateResult.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(`DELETE FROM session_messages WHERE session_id = $1`, [sessionId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return loadSession(pool, sessionId);
    }
  };
}
