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
