import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { initialDefaults } from "../defaults.js";
import { createPostgresSessionStore } from "./postgres.js";

function createTestStore() {
  const db = newDb();
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();

  return createPostgresSessionStore({ pool });
}

test("postgres store boots defaults and initial session", async (t) => {
  const store = createTestStore();
  t.after(async () => {
    await store.close();
  });
  await store.init();

  const defaults = await store.getDefaults();
  const sessions = await store.listSessions();

  assert.equal(defaults.systemPrompt, initialDefaults.systemPrompt);
  assert.deepEqual(sessions, [
    {
      id: "sess_1",
      title: "New chat",
      model: "llama3.1:8b",
      updatedAt: "2026-04-20T18:00:00.000Z"
    }
  ]);
});

test("postgres store persists updates across store instances sharing the same database", async (t) => {
  const db = newDb();
  const adapter = db.adapters.createPg();
  const poolA = new adapter.Pool();
  const poolB = new adapter.Pool();
  const storeA = createPostgresSessionStore({ pool: poolA });
  const storeB = createPostgresSessionStore({ pool: poolB });
  t.after(async () => {
    await storeA.close();
    await storeB.close();
  });
  await storeA.init();
  await storeB.init();

  const created = await storeA.createSession({
    title: "Shared session",
    model: "qwen2.5-coder:7b",
    createdAt: "2026-04-20T18:10:00.000Z"
  });
  await storeA.appendMessage(created.id, {
    id: "msg_user_sync",
    role: "user",
    content: "Remember this.",
    createdAt: "2026-04-20T18:10:01.000Z"
  });

  const session = await storeB.getSession(created.id);

  assert.ok(session);
  assert.equal(session.title, "Shared session");
  assert.deepEqual(session.messages, [
    {
      id: "msg_user_sync",
      role: "user",
      content: "Remember this.",
      createdAt: "2026-04-20T18:10:01.000Z"
    }
  ]);
});

test("postgres store persists defaults and cleared overrides exactly", async (t) => {
  const store = createTestStore();
  t.after(async () => {
    await store.close();
  });
  await store.init();

  const updatedDefaults = await store.setDefaults({
    ...initialDefaults,
    requestHistoryCount: 4,
    responseHistoryCount: 3,
    options: {
      ...initialDefaults.options,
      temperature: 0.2
    }
  });

  assert.equal(updatedDefaults.requestHistoryCount, 4);
  assert.equal((await store.getDefaults()).options.temperature, 0.2);

  const updatedSession = await store.updateSession("sess_1", {
    overrides: {
      systemPrompt: "Focus on code.",
      requestHistoryCount: 1,
      responseHistoryCount: 1,
      temperature: 0.15,
      num_ctx: 2048
    },
    updatedAt: "2026-04-20T18:16:00.000Z"
  });

  assert.ok(updatedSession);
  assert.deepEqual(updatedSession.overrides, {
    systemPrompt: "Focus on code.",
    requestHistoryCount: 1,
    responseHistoryCount: 1,
    temperature: 0.15,
    num_ctx: 2048
  });

  const clearedSession = await store.updateSession("sess_1", {
    overrides: {},
    updatedAt: "2026-04-20T18:16:05.000Z"
  });

  assert.ok(clearedSession);
  assert.deepEqual(clearedSession.overrides, {});
});

test("postgres store preserves assistant thinking content", async (t) => {
  const store = createTestStore();
  t.after(async () => {
    await store.close();
  });
  await store.init();

  await store.appendAssistantResult("sess_1", {
    message: {
      id: "msg_assistant_1",
      role: "assistant",
      content: "Here is the answer.",
      createdAt: "2026-04-20T18:12:00.000Z"
    },
    thinking: {
      content: "Think step by step internally.",
      collapsedByDefault: true
    }
  });

  const session = await store.getSession("sess_1");

  assert.ok(session);
  assert.deepEqual(session.messages, [
    {
      id: "msg_assistant_1",
      role: "assistant",
      content: "Here is the answer.",
      createdAt: "2026-04-20T18:12:00.000Z",
      thinking: {
        content: "Think step by step internally.",
        collapsedByDefault: true
      }
    }
  ]);
});

test("postgres store init retries transient DNS failures", async () => {
  let attempts = 0;
  const pool = {
    async query(sql: string) {
      attempts += 1;

      if (attempts <= 2) {
        const error = new Error("getaddrinfo ENOTFOUND postgres") as Error & { code: string };
        error.code = "ENOTFOUND";
        throw error;
      }

      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ exists: false }] };
      }

      if (sql.includes("SELECT version FROM session_service_migrations")) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }
  };

  const store = createPostgresSessionStore({ pool: pool as never });

  await store.init();

  assert.ok(attempts >= 3);
});

test("postgres store init does not retry non-retryable failures", async () => {
  let attempts = 0;
  const pool = {
    async query() {
      attempts += 1;
      const error = new Error("syntax error at or near SELECT") as Error & { code: string };
      error.code = "42601";
      throw error;
    }
  };

  const store = createPostgresSessionStore({ pool: pool as never });

  await assert.rejects(store.init(), /syntax error/i);
  assert.equal(attempts, 1);
});
