import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/models fetches normalized models from the provider adapter", async () => {
  const app = createApp({
    config: {
      port: 4002,
      ollamaAdapterUrl: "http://ollama-adapter:4005",
      modelCacheTtlMs: 30_000
    },
    fetchImpl: async (input) =>
      new Response(
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
      )
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/models"
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
