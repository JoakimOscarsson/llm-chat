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
    "event: queued",
    'data: {"requestId":"req_1","position":1,"queueDepth":1,"model":"qwen2.5-coder:7b","promptAfterMs":12000}',
    "",
    "event: started",
    'data: {"requestId":"req_1","model":"qwen2.5-coder:7b","startedAt":"2026-04-21T12:00:15.000Z"}',
    "",
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
  assert.match(response.body, /event: queued/);
  assert.match(response.body, /event: started/);
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

test("POST /internal/chat/stream does not persist queued requests that are cancelled before execution starts", async () => {
  const streamBody = [
    "event: queued",
    'data: {"requestId":"req_queued","position":2,"queueDepth":2,"model":"qwen2.5-coder:7b","promptAfterMs":12000}',
    "",
    "event: queue_update",
    'data: {"requestId":"req_queued","position":1,"queueDepth":1}',
    "",
    "event: done",
    'data: {"finishReason":"queued_cancelled"}',
    "",
    ""
  ].join("\n");
  let patchedTitleCalled = false;
  let persistedMessageCalled = false;
  let persistedAssistantCalled = false;

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input) => {
      const url = String(input);

      if (url === "http://session-service:4003/internal/sessions/sess_1/context") {
        return new Response(
          JSON.stringify({
            sessionId: "sess_1",
            model: "qwen2.5-coder:7b",
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

      if (url === "http://session-service:4003/internal/sessions/sess_1/messages") {
        persistedMessageCalled = true;
        throw new Error("queued cancel should not persist user message");
      }

      if (url === "http://session-service:4003/internal/sessions/sess_1/assistant-result") {
        persistedAssistantCalled = true;
        throw new Error("queued cancel should not persist assistant result");
      }

      if (url === "http://session-service:4003/internal/sessions/sess_1") {
        patchedTitleCalled = true;
        throw new Error("queued cancel should not patch title");
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
      requestId: "req_queued",
      sessionId: "sess_1",
      model: "qwen2.5-coder:7b",
      message: "Wait in line"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: queued/);
  assert.match(response.body, /event: queue_update/);
  assert.match(response.body, /"finishReason":"queued_cancelled"/);
  assert.equal(patchedTitleCalled, false);
  assert.equal(persistedMessageCalled, false);
  assert.equal(persistedAssistantCalled, false);
});

test("POST /internal/chat/stream persists the user turn once execution starts, but skips empty assistant turns on cancellation", async () => {
  const streamBody = [
    "event: started",
    'data: {"requestId":"req_cancel","model":"llama3.1:8b","startedAt":"2026-04-21T12:00:15.000Z"}',
    "",
    "event: done",
    'data: {"finishReason":"cancelled"}',
    "",
    ""
  ].join("\n");
  const persistedBodies: string[] = [];
  let patchedTitleBody = "";

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

      if (url === "http://session-service:4003/internal/sessions/sess_1/messages") {
        persistedBodies.push(String(init?.body ?? ""));

        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "Cancel path",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:01.000Z",
              messages: [],
              overrides: {}
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      if (url === "http://session-service:4003/internal/sessions/sess_1/assistant-result") {
        persistedBodies.push(String(init?.body ?? ""));
        throw new Error("cancelled empty assistant turn should not be persisted");
      }

      if (url === "http://session-service:4003/internal/sessions/sess_1") {
        patchedTitleBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "Cancel path",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:01.000Z",
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
      requestId: "req_cancel",
      sessionId: "sess_1",
      model: "llama3.1:8b",
      message: "Please start then cancel"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: started/);
  assert.equal(persistedBodies.length, 1);
  assert.match(persistedBodies[0] ?? "", /"role":"user","content":"Please start then cancel"/);
  assert.match(patchedTitleBody, /"title":"Start then cancel"/);
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
  let patchedTitleBody = "";

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

      if (url === "http://session-service:4003/internal/sessions/sess_1") {
        patchedTitleBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "Count to 2.",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:02.000Z",
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
  assert.match(patchedTitleBody, /"title":"Count to 2\."/
  );
});

test("POST /internal/chat/stream generates a short title only for the first chat turn", async () => {
  let patchedTitleBody = "";

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
        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "New chat",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:01.000Z",
              messages: [],
              overrides: {}
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      if (url === "http://session-service:4003/internal/sessions/sess_1") {
        patchedTitleBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "Fix nginx",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:00:02.000Z",
              messages: [],
              overrides: {}
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      if (url === "http://ollama-adapter:4005/internal/provider/chat/stream") {
        return new Response(
          [
            "event: response_delta",
            'data: {"text":"Use the nginx proxy_pass directive."}',
            "",
            "event: done",
            'data: {"finishReason":"stop"}',
            "",
            ""
          ].join("\n"),
          {
            headers: {
              "content-type": "text/event-stream"
            }
          }
        );
      }

      throw new Error(`Unexpected url: ${url}`);
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/chat/stream",
    payload: {
      requestId: "req_title",
      sessionId: "sess_1",
      model: "llama3.1:8b",
      message: "Help me fix nginx"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: session_title/);
  assert.match(response.body, /"title":"Fix nginx"/);
  assert.match(patchedTitleBody, /"title":"Fix nginx"/);
});

test("GET /internal/chat/runtime proxies the adapter runtime payload", async () => {
  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), "http://ollama-adapter:4005/internal/provider/runtime");

      return new Response(
        JSON.stringify({
          busy: true,
          activeRequests: 1,
          maxParallelRequests: 1,
          queueDepth: 2,
          residentModels: ["gemma4"],
          fastPathModels: ["gemma4"],
          fetchedAt: "2026-04-21T12:00:00.000Z"
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/chat/runtime"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    busy: true,
    activeRequests: 1,
    maxParallelRequests: 1,
    queueDepth: 2,
    residentModels: ["gemma4"],
    fastPathModels: ["gemma4"],
    fetchedAt: "2026-04-21T12:00:00.000Z"
  });
});

test("PATCH /internal/chat/requests/:requestId proxies queued request retargeting", async () => {
  let forwardedBody = "";

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://ollama-adapter:4005/internal/provider/chat/requests/req_123");
      assert.equal(init?.method, "PATCH");
      forwardedBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          request: {
            requestId: "req_123",
            state: "queued",
            model: "qwen2.5-coder:7b",
            position: 2,
            queueDepth: 2,
            queuedAt: "2026-04-21T12:00:03.000Z"
          }
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
  });

  const response = await app.inject({
    method: "PATCH",
    url: "/internal/chat/requests/req_123",
    payload: {
      model: "qwen2.5-coder:7b"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(forwardedBody, /"model":"qwen2.5-coder:7b"/);
  assert.equal(response.json().request.state, "queued");
});

test("POST /internal/chat/stop proxies the stop request to the adapter even without local request ownership", async () => {
  let stopForwarded = false;

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "http://ollama-adapter:4005/internal/provider/chat/stop") {
        stopForwarded = true;
        assert.equal(init?.method, "POST");

        return new Response(JSON.stringify({ stopped: true, requestId: "req_1" }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`Unexpected url: ${String(input)}`);
    }
  });

  const stopResponse = await app.inject({
    method: "POST",
    url: "/internal/chat/stop",
    payload: {
      requestId: "req_1"
    }
  });

  assert.equal(stopResponse.statusCode, 200);
  assert.deepEqual(stopResponse.json(), {
    stopped: true,
    requestId: "req_1"
  });
  assert.equal(stopForwarded, true);
});
