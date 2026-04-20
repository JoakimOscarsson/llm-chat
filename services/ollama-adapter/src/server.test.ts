import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/provider/models forwards Cloudflare headers and normalizes tags", async () => {
  let seenHeaders: Headers | undefined;

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000
    },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://example-ollama.test/api/tags");
      seenHeaders = new Headers(init?.headers);

      return new Response(
        JSON.stringify({
          models: [
            {
              name: "llama3.1:8b",
              modified_at: "2026-04-20T18:00:00Z",
              size: 123
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
    url: "/internal/provider/models"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenHeaders?.get("CF-Access-Client-Id"), "client-id");
  assert.equal(seenHeaders?.get("CF-Access-Client-Secret"), "client-secret");

  assert.deepEqual(response.json().models, [
    {
      name: "llama3.1:8b",
      modifiedAt: "2026-04-20T18:00:00Z",
      size: 123
    }
  ]);
});
