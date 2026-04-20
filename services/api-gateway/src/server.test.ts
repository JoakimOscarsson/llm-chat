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
