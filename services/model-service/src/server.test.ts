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
              size: 123,
              chatCapable: true,
              capabilities: ["completion"],
              family: "llama",
              families: ["llama"]
            },
            {
              name: "embeddinggemma",
              modifiedAt: "2026-04-20T18:01:00Z",
              size: 456,
              chatCapable: false,
              capabilities: ["embedding"],
              family: "embeddinggemma",
              families: ["embeddinggemma"]
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
      size: 123,
      chatCapable: true,
      capabilities: ["completion"],
      family: "llama",
      families: ["llama"]
    }
  ]);
});

test("POST /internal/models/warm proxies model warmup to the provider adapter", async () => {
  let forwardedBody = "";

  const app = createApp({
    config: {
      port: 4002,
      ollamaAdapterUrl: "http://ollama-adapter:4005",
      modelCacheTtlMs: 30_000
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://ollama-adapter:4005/internal/provider/models/warm");
      assert.equal(init?.method, "POST");
      forwardedBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          ready: true,
          model: "qwen2.5-coder:7b",
          warmedAt: "2026-04-20T18:04:00Z",
          loadDuration: 125_000_000,
          totalDuration: 130_000_000
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
    method: "POST",
    url: "/internal/models/warm",
    payload: {
      model: "qwen2.5-coder:7b",
      keep_alive: -1
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(forwardedBody, /"model":"qwen2.5-coder:7b"/);
  assert.equal(response.json().ready, true);
  assert.equal(response.json().model, "qwen2.5-coder:7b");
});
