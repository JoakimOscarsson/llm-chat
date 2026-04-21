import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { createApp } from "./server.js";
import { createPostgresSessionStore } from "./stores/postgres.js";

async function createPostgresBackedApps() {
  const db = newDb();
  const adapter = db.adapters.createPg();
  const storeA = createPostgresSessionStore({ pool: new adapter.Pool() });
  const storeB = createPostgresSessionStore({ pool: new adapter.Pool() });

  await storeA.init();
  await storeB.init();

  const appA = createApp({
    config: {
      port: 0,
      sessionStoreDriver: "postgres",
      sessionStoreUrl: "postgresql://unused"
    },
    store: storeA
  });
  const appB = createApp({
    config: {
      port: 0,
      sessionStoreDriver: "postgres",
      sessionStoreUrl: "postgresql://unused"
    },
    store: storeB
  });

  return { appA, appB };
}

test("postgres-backed apps share session state across instances", async (t) => {
  const { appA, appB } = await createPostgresBackedApps();
  t.after(async () => {
    await appA.close();
    await appB.close();
  });

  const createResponse = await appA.inject({
    method: "POST",
    url: "/internal/sessions",
    payload: {
      title: "Cluster-safe",
      model: "gemma4"
    }
  });

  assert.equal(createResponse.statusCode, 200);
  const sessionId = createResponse.json().session.id;

  await appA.inject({
    method: "POST",
    url: `/internal/sessions/${sessionId}/messages`,
    payload: {
      message: {
        id: "msg_shared_1",
        role: "user",
        content: "hello from app A",
        createdAt: "2026-04-20T18:15:00.000Z"
      }
    }
  });

  const sessionResponse = await appB.inject({
    method: "GET",
    url: `/internal/sessions/${sessionId}`
  });

  assert.equal(sessionResponse.statusCode, 200);
  assert.deepEqual(sessionResponse.json().session.messages, [
    {
      id: "msg_shared_1",
      role: "user",
      content: "hello from app A",
      createdAt: "2026-04-20T18:15:00.000Z"
    }
  ]);
});

test("postgres-backed apps share defaults updates across instances", async (t) => {
  const { appA, appB } = await createPostgresBackedApps();
  t.after(async () => {
    await appA.close();
    await appB.close();
  });

  const updateResponse = await appA.inject({
    method: "PUT",
    url: "/internal/settings/defaults",
    payload: {
      defaults: {
        systemPrompt: "Use markdown with short paragraphs.",
        requestHistoryCount: 4,
        responseHistoryCount: 3,
        streamThinking: false,
        persistSessions: true,
        options: {
          temperature: 0.2,
          top_k: 20,
          top_p: 0.85,
          repeat_penalty: 1.1,
          num_ctx: 4096,
          num_predict: 256,
          stop: ["<END>"]
        }
      }
    }
  });

  assert.equal(updateResponse.statusCode, 200);

  const readResponse = await appB.inject({
    method: "GET",
    url: "/internal/settings/defaults"
  });

  assert.equal(readResponse.statusCode, 200);
  assert.equal(readResponse.json().defaults.requestHistoryCount, 4);
  assert.equal(readResponse.json().defaults.options.temperature, 0.2);
  assert.equal(readResponse.json().defaults.streamThinking, false);
});
