import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /api/models proxies the model service response", async () => {
  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), "http://model-service:4002/internal/models");

      return new Response(
        JSON.stringify({
          models: [
            {
              name: "llama3.1:8b",
              modifiedAt: "2026-04-20T18:00:00Z",
              size: 123
            }
          ],
          fetchedAt: "2026-04-20T18:00:00Z"
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
    url: "/api/models"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models, [
    {
      name: "llama3.1:8b",
      modifiedAt: "2026-04-20T18:00:00Z",
      size: 123
    }
  ]);
});

test("GET /api/sessions proxies the session service response", async () => {
  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), "http://session-service:4003/internal/sessions");

      return new Response(
        JSON.stringify({
          sessions: [
            {
              id: "sess_1",
              title: "New chat",
              model: "llama3.1:8b",
              updatedAt: "2026-04-20T18:00:00.000Z"
            }
          ]
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
    url: "/api/sessions"
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

test("GET /api/settings/defaults proxies the session service defaults", async () => {
  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), "http://session-service:4003/internal/settings/defaults");

      return new Response(
        JSON.stringify({
          defaults: {
            systemPrompt: "Use markdown.",
            requestHistoryCount: 4,
            responseHistoryCount: 4,
            streamThinking: true,
            persistSessions: true,
            options: {
              temperature: 0.3,
              top_k: 20,
              top_p: 0.85,
              repeat_penalty: 1.1,
              num_ctx: 4096,
              num_predict: 256,
              stop: []
            }
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
    method: "GET",
    url: "/api/settings/defaults"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().defaults.options.temperature, 0.3);
});

test("PUT /api/settings/defaults proxies default updates", async () => {
  let forwardedBody = "";

  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://session-service:4003/internal/settings/defaults");
      assert.equal(init?.method, "PUT");
      forwardedBody = String(init?.body ?? "");

      return new Response(String(init?.body ?? ""), {
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });

  const response = await app.inject({
    method: "PUT",
    url: "/api/settings/defaults",
    payload: {
      defaults: {
        systemPrompt: "Use bullets.",
        requestHistoryCount: 6,
        responseHistoryCount: 3,
        streamThinking: false,
        persistSessions: true,
        options: {
          temperature: 0.2,
          top_k: 10,
          top_p: 0.8,
          repeat_penalty: 1.1,
          num_ctx: 4096,
          num_predict: 128,
          stop: []
        }
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(forwardedBody, /"systemPrompt":"Use bullets\."/);
  assert.equal(response.json().defaults.streamThinking, false);
});

test("PATCH /api/sessions/:sessionId proxies session override updates", async () => {
  let forwardedBody = "";

  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://session-service:4003/internal/sessions/sess_1");
      assert.equal(init?.method, "PATCH");
      forwardedBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "New chat",
            model: "qwen2.5-coder:7b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:00:00.000Z",
            messages: [],
            overrides: {
              requestHistoryCount: 2,
              temperature: 0.1
            }
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
    url: "/api/sessions/sess_1",
    payload: {
      model: "qwen2.5-coder:7b",
      overrides: {
        requestHistoryCount: 2,
        temperature: 0.1
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(forwardedBody, /"requestHistoryCount":2/);
  assert.equal(response.json().session.model, "qwen2.5-coder:7b");
});

test("DELETE /api/sessions/:sessionId/history proxies clear-history requests", async () => {
  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://session-service:4003/internal/sessions/sess_1/history");
      assert.equal(init?.method, "DELETE");

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
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
  });

  const response = await app.inject({
    method: "DELETE",
    url: "/api/sessions/sess_1/history"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().session.messages, []);
});

test("GET /api/health aggregates downstream service health", async () => {
  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({
            status: "ok"
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      throw new Error(`Unexpected url: ${url}`);
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/health"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "api-gateway",
    dependencies: {
      chatService: "ok",
      modelService: "ok",
      sessionService: "ok",
      metricsService: "ok"
    }
  });
});

test("POST /api/chat/stream relays chat-service stream events", async () => {
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

  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "http://chat-service:4001/internal/chat/stream") {
        assert.equal(init?.method, "POST");

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
    url: "/api/chat/stream",
    payload: {
      model: "llama3.1:8b",
      message: "Hello"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: thinking_delta/);
  assert.match(response.body, /event: response_delta/);
});

test("POST /api/chat/stop proxies the stop request to the chat service", async () => {
  const app = createApp({
    config: {
      port: 4000,
      chatServiceUrl: "http://chat-service:4001",
      modelServiceUrl: "http://model-service:4002",
      sessionServiceUrl: "http://session-service:4003",
      metricsServiceUrl: "http://metrics-service:4004"
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "http://chat-service:4001/internal/chat/stop") {
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

  const response = await app.inject({
    method: "POST",
    url: "/api/chat/stop",
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
