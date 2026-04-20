import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("POST /internal/chat/stream relays adapter stream events", async () => {
  const streamBody = [
    "event: meta",
    'data: {"requestId":"req_1","model":"llama3.1:8b"}',
    "",
    "event: thinking_delta",
    'data: {"text":"Thinking..."}',
    "",
    "event: response_delta",
    'data: {"text":"Hello there"}',
    "",
    "event: done",
    'data: {"finishReason":"stop"}',
    "",
    ""
  ].join("\n");
  let forwardedBody = "";

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://ollama-adapter:4005/internal/provider/chat/stream");
      forwardedBody = String(init?.body ?? "");

      return new Response(streamBody, {
        headers: {
          "content-type": "text/event-stream"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/chat/stream",
    payload: {
      model: "llama3.1:8b",
      message: "Hello"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: thinking_delta/);
  assert.match(response.body, /event: response_delta/);
  assert.match(forwardedBody, /"messages":\[\{"role":"user","content":"Hello"\}\]/);
});

test("POST /internal/chat/stream shapes messages and options from session context", async () => {
  const streamBody = [
    "event: meta",
    'data: {"requestId":"req_1","model":"qwen2.5-coder:7b"}',
    "",
    "event: done",
    'data: {"finishReason":"stop"}',
    "",
    ""
  ].join("\n");
  let forwardedBody = "";
  const persistedBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "http://session-service:4003/internal/sessions/sess_1/context") {
        return new Response(
          JSON.stringify({
            sessionId: "sess_1",
            model: "llama3.1:8b",
            globalDefaults: {
              systemPrompt: "Use markdown.",
              requestHistoryCount: 8,
              responseHistoryCount: 8,
              streamThinking: true,
              persistSessions: true,
              options: {
                temperature: 0.7,
                top_k: 40,
                top_p: 0.9,
                repeat_penalty: 1.05,
                num_ctx: 8192,
                num_predict: 512,
                stop: [],
                keep_alive: "10m"
              }
            },
            overrides: {
              systemPrompt: "Focus on code fixes.",
              requestHistoryCount: 1,
              responseHistoryCount: 1,
              temperature: 0.1,
              num_ctx: 2048
            },
            history: [
              { role: "user", content: "Previous question" },
              { role: "assistant", content: "Previous answer" }
            ]
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      if (
        String(input) === "http://session-service:4003/internal/sessions/sess_1/messages" ||
        String(input) === "http://session-service:4003/internal/sessions/sess_1/assistant-result"
      ) {
        persistedBodies.push(String(init?.body ?? ""));

        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "New chat",
              model: "qwen2.5-coder:7b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:00.000Z",
              messages: [],
              overrides: {}
            }
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      if (String(input) === "http://ollama-adapter:4005/internal/provider/chat/stream") {
        forwardedBody = String(init?.body ?? "");

        return new Response(streamBody, {
          headers: {
            "content-type": "text/event-stream"
          }
        });
      }

      throw new Error(`Unexpected url: ${String(input)}`);
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/chat/stream",
    payload: {
      requestId: "req_1",
      sessionId: "sess_1",
      model: "qwen2.5-coder:7b",
      message: "Please fix it."
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(forwardedBody, /"model":"qwen2\.5-coder:7b"/);
  assert.match(forwardedBody, /"role":"system","content":"Focus on code fixes\."/);
  assert.match(forwardedBody, /"role":"user","content":"Previous question"/);
  assert.match(forwardedBody, /"role":"assistant","content":"Previous answer"/);
  assert.match(forwardedBody, /"role":"user","content":"Please fix it\."}/);
  assert.match(forwardedBody, /"temperature":0\.1/);
  assert.match(forwardedBody, /"num_ctx":2048/);
  assert.match(forwardedBody, /"keep_alive":"10m"/);
  assert.equal(persistedBodies.length, 2);
  assert.match(persistedBodies[0] ?? "", /"role":"user","content":"Please fix it\."/);
  assert.match(persistedBodies[1] ?? "", /"role":"assistant","content":""/);
});

test("POST /internal/chat/stream persists streamed assistant content and thinking traces", async () => {
  const streamBody = [
    "event: meta",
    'data: {"requestId":"req_2","model":"llama3.1:8b"}',
    "",
    "event: thinking_delta",
    'data: {"text":"Plan first."}',
    "",
    "event: response_delta",
    'data: {"text":"One"}',
    "",
    "event: response_delta",
    'data: {"text":" two"}',
    "",
    "event: done",
    'data: {"finishReason":"stop"}',
    "",
    ""
  ].join("\n");
  const persistedBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      const url = String(input);

      if (url === "http://session-service:4003/internal/sessions/sess_1/context") {
        return new Response(
          JSON.stringify({
            sessionId: "sess_1",
            model: "llama3.1:8b",
            globalDefaults: {
              systemPrompt: "Use markdown.",
              requestHistoryCount: 8,
              responseHistoryCount: 8,
              streamThinking: true,
              persistSessions: true,
              options: {
                temperature: 0.7,
                top_k: 40,
                top_p: 0.9,
                repeat_penalty: 1.05,
                num_ctx: 8192,
                num_predict: 512,
                stop: []
              }
            },
            overrides: {},
            history: []
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      if (
        url === "http://session-service:4003/internal/sessions/sess_1/messages" ||
        url === "http://session-service:4003/internal/sessions/sess_1/assistant-result"
      ) {
        persistedBodies.push(String(init?.body ?? ""));

        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "New chat",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:00.000Z",
              messages: [],
              overrides: {}
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      if (url === "http://ollama-adapter:4005/internal/provider/chat/stream") {
        return new Response(streamBody, {
          headers: {
            "content-type": "text/event-stream"
          }
        });
      }

      throw new Error(`Unexpected url: ${url}`);
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/chat/stream",
    payload: {
      requestId: "req_2",
      sessionId: "sess_1",
      model: "llama3.1:8b",
      message: "Count to 2."
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(persistedBodies.length, 2);
  assert.match(persistedBodies[0] ?? "", /"role":"user","content":"Count to 2\."/);
  assert.match(persistedBodies[1] ?? "", /"role":"assistant","content":"One two"/);
  assert.match(persistedBodies[1] ?? "", /"thinking":\{"content":"Plan first\."/);
});

test("POST /internal/chat/stop aborts an in-flight stream and forwards the stop request", async () => {
  let aborted = false;
  let stopForwarded = false;

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "http://ollama-adapter:4005/internal/provider/chat/stream") {
        const signal = init?.signal as AbortSignal | undefined;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }

      if (String(input) === "http://ollama-adapter:4005/internal/provider/chat/stop") {
        stopForwarded = true;

        return new Response(JSON.stringify({ stopped: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`Unexpected url: ${String(input)}`);
    }
  });

  const streamPromise = app.inject({
    method: "POST",
    url: "/internal/chat/stream",
    payload: {
      requestId: "req_1",
      model: "llama3.1:8b",
      message: "Hello"
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const stopResponse = await app.inject({
    method: "POST",
    url: "/internal/chat/stop",
    payload: {
      requestId: "req_1"
    }
  });

  const streamResponse = await streamPromise;

  assert.equal(stopResponse.statusCode, 200);
  assert.deepEqual(stopResponse.json(), {
    stopped: true,
    requestId: "req_1"
  });
  assert.equal(streamResponse.statusCode, 499);
  assert.equal(aborted, true);
  assert.equal(stopForwarded, true);
});
