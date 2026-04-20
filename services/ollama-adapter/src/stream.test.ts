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
    stopped: true,
    requestId: "req_1"
  });
});

test("POST /internal/provider/chat/stream normalizes a real Ollama NDJSON stream", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "qwen3:8b",
      message: {
        role: "assistant",
        thinking: "Consider the problem."
      },
      done: false
    }),
    JSON.stringify({
      model: "qwen3:8b",
      message: {
        role: "assistant",
        content: "Here is the answer."
      },
      done: false
    }),
    JSON.stringify({
      model: "qwen3:8b",
      done: true,
      done_reason: "stop",
      total_duration: 100,
      load_duration: 20,
      prompt_eval_count: 10,
      prompt_eval_duration: 30,
      eval_count: 5,
      eval_duration: 50
    })
  ].join("\n");

  let forwardedHeaders: Record<string, string> | undefined;
  let forwardedBody = "";

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://example-ollama.test/api/chat");
      forwardedHeaders = init?.headers as Record<string, string> | undefined;
      forwardedBody = String(init?.body ?? "");

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "qwen3:8b",
      messages: [{ role: "user", content: "Hello" }],
      streamThinking: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: meta/);
  assert.match(response.body, /event: thinking_delta/);
  assert.match(response.body, /Consider the problem/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /Here is the answer/);
  assert.match(response.body, /event: usage/);
  assert.match(response.body, /event: done/);
  assert.ok(forwardedHeaders);
  assert.equal(forwardedHeaders?.["CF-Access-Client-Id"], "client-id");
  assert.equal(forwardedHeaders?.["CF-Access-Client-Secret"], "client-secret");
  assert.match(forwardedBody, /"stream":true/);
  assert.match(forwardedBody, /"messages":\[/);
});

test("POST /internal/provider/chat/stream includes model details in upstream error events", async () => {
  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async () =>
      new Response("model not found", {
        status: 404,
        headers: {
          "content-type": "text/plain"
        }
      })
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_404",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Hello" }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: error/);
  assert.match(response.body, /qwen2\.5-coder:7b/);
  assert.match(response.body, /model not found/);
  assert.match(response.body, /"status":404/);
});

test("POST /internal/provider/chat/stream falls back when thinking is unsupported", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "llama3.2:3b",
      message: {
        role: "assistant",
        content: "Plain response."
      },
      done: false
    }),
    JSON.stringify({
      model: "llama3.2:3b",
      done: true,
      done_reason: "stop"
    })
  ].join("\n");

  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      if (requestBodies.length === 1) {
        return new Response("thinking not supported for this model", {
          status: 400,
          headers: {
            "content-type": "text/plain"
          }
        });
      }

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_retry",
      model: "llama3.2:3b",
      messages: [{ role: "user", content: "Hello" }],
      streamThinking: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0] ?? "", /"think":true/);
  assert.doesNotMatch(requestBodies[1] ?? "", /"think":true/);
  assert.match(response.body, /event: thinking_unavailable/);
  assert.match(response.body, /does not support thinking/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /Plain response/);
  assert.match(response.body, /event: done/);
});

test("POST /internal/provider/chat/stream falls back for Ollama JSON thinking errors", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "qwen2.5-coder:7b",
      message: {
        role: "assistant",
        content: "Streaming without a separate reasoning trace."
      },
      done: false
    }),
    JSON.stringify({
      model: "qwen2.5-coder:7b",
      done: true,
      done_reason: "stop"
    })
  ].join("\n");

  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: "\"qwen2.5-coder:7b\" does not support thinking" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_qwen_retry",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Hello" }],
      streamThinking: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0] ?? "", /"think":true/);
  assert.doesNotMatch(requestBodies[1] ?? "", /"think":true/);
  assert.match(response.body, /event: thinking_unavailable/);
  assert.match(response.body, /qwen2\.5-coder:7b/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /Streaming without a separate reasoning trace/);
  assert.doesNotMatch(response.body, /event: error/);
});
