import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("POST /internal/provider/chat/stream returns stub thinking and response events", async () => {
  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: true
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      model: "llama3.1:8b",
      message: "Hello"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: meta/);
  assert.match(response.body, /event: thinking_delta/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /event: done/);
});

test("POST /internal/provider/chat/stop acknowledges a stop request", async () => {
  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: true
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stop",
    payload: {
      requestId: "req_1"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    stopped: true
  });
});
