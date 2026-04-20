import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/sessions returns session summaries", async () => {
  const app = createApp();

  const response = await app.inject({
    method: "GET",
    url: "/internal/sessions"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().sessions, [
    {
      id: "sess_1",
      title: "New chat",
      model: "llama3.1:8b",
      updatedAt: "2026-04-20T18:00:00.000Z"
    }
  ]);
});

test("GET /internal/settings/defaults returns app defaults", async () => {
  const app = createApp();

  const response = await app.inject({
    method: "GET",
    url: "/internal/settings/defaults"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().defaults.requestHistoryCount, 8);
  assert.equal(response.json().defaults.options.temperature, 0.7);
  assert.equal(response.json().defaults.streamThinking, true);
});

test("PUT /internal/settings/defaults updates app defaults", async () => {
  const app = createApp();

  const response = await app.inject({
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

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().defaults.systemPrompt, "Use markdown with short paragraphs.");
  assert.equal(response.json().defaults.options.temperature, 0.2);
  assert.equal(response.json().defaults.streamThinking, false);
});

test("PATCH /internal/sessions/:sessionId updates overrides and context shaping", async () => {
  const app = createApp();

  const patchResponse = await app.inject({
    method: "PATCH",
    url: "/internal/sessions/sess_1",
    payload: {
      model: "qwen2.5-coder:7b",
      overrides: {
        systemPrompt: "Focus on code.",
        requestHistoryCount: 1,
        responseHistoryCount: 1,
        temperature: 0.15,
        num_ctx: 2048
      }
    }
  });

  assert.equal(patchResponse.statusCode, 200);
  assert.equal(patchResponse.json().session.model, "qwen2.5-coder:7b");
  assert.equal(patchResponse.json().session.overrides.systemPrompt, "Focus on code.");

  const contextResponse = await app.inject({
    method: "GET",
    url: "/internal/sessions/sess_1/context"
  });

  assert.equal(contextResponse.statusCode, 200);
  assert.equal(contextResponse.json().model, "qwen2.5-coder:7b");
  assert.deepEqual(contextResponse.json().history, [
    {
      role: "user",
      content: "Show me the failing command."
    },
    {
      role: "assistant",
      content: "The command exits with code 127."
    }
  ]);
  assert.equal(contextResponse.json().overrides.num_ctx, 2048);
});

test("POST /internal/sessions/:sessionId/messages and /assistant-result persist new turns into context history", async () => {
  const app = createApp();

  const userResponse = await app.inject({
    method: "POST",
    url: "/internal/sessions/sess_1/messages",
    payload: {
      message: {
        id: "msg_user_new",
        role: "user",
        content: "Count to 10.",
        createdAt: "2026-04-20T18:01:00.000Z"
      }
    }
  });

  assert.equal(userResponse.statusCode, 200);

  const assistantResponse = await app.inject({
    method: "POST",
    url: "/internal/sessions/sess_1/assistant-result",
    payload: {
      message: {
        id: "msg_assistant_new",
        role: "assistant",
        content: "1 2 3 4 5 6 7 8 9 10",
        createdAt: "2026-04-20T18:01:03.000Z"
      },
      thinking: {
        content: "Continue the counting sequence cleanly.",
        collapsedByDefault: true
      }
    }
  });

  assert.equal(assistantResponse.statusCode, 200);

  const contextResponse = await app.inject({
    method: "GET",
    url: "/internal/sessions/sess_1/context"
  });

  assert.equal(contextResponse.statusCode, 200);
  assert.deepEqual(contextResponse.json().history.slice(-2), [
    {
      role: "user",
      content: "Count to 10."
    },
    {
      role: "assistant",
      content: "1 2 3 4 5 6 7 8 9 10"
    }
  ]);
});
