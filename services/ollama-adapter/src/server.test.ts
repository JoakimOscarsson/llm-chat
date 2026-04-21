import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/provider/models returns stub models when stub mode is enabled", async () => {
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
    method: "GET",
    url: "/internal/provider/models"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models, [
    {
      name: "llama3.1:8b",
      modifiedAt: "2026-04-20T18:00:00.000Z",
      size: 4661224676,
      chatCapable: true,
      capabilities: ["completion"],
      family: "llama",
      families: ["llama"]
    }
  ]);
});

test("GET /internal/provider/models forwards Cloudflare headers and normalizes tags", async () => {
  let seenHeaders: Headers | undefined;

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
      if (String(input) === "https://example-ollama.test/api/tags") {
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

      if (String(input) === "https://example-ollama.test/api/show") {
        return new Response(
          JSON.stringify({
            details: {
              family: "llama",
              families: ["llama"]
            },
            capabilities: ["completion"]
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      throw new Error(`Unhandled fetch for ${String(input)}`);
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
      size: 123,
      chatCapable: true,
      capabilities: ["completion"],
      family: "llama",
      families: ["llama"]
    }
  ]);
});

test("POST /internal/provider/chat/title returns a short sanitized title", async () => {
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
      forwardedBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              title: "  Fix nginx config and proxy headers  "
            })
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
    method: "POST",
    url: "/internal/provider/chat/title",
    payload: {
      model: "llama3.1:8b",
      maxLength: 24,
      messages: [
        {
          role: "user",
          content: "Help me fix my nginx reverse proxy."
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(forwardedBody, /"stream":false/);
  assert.match(forwardedBody, /"maxLength":24/);
  assert.equal(response.json().title.length <= 24, true);
  assert.equal(response.json().title, "Fix nginx config and");
});
