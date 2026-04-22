import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";
import { InMemoryQueueCoordinator } from "./coordination.js";
import { createDeferred, waitFor } from "./test-helpers.js";

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
      capabilitySource: "stub",
      capabilities: ["completion"],
      family: "llama",
      families: ["llama"]
    },
    {
      name: "qwen2.5-coder:7b",
      modifiedAt: "2026-04-20T18:00:00.000Z",
      size: 4511224676,
      chatCapable: true,
      capabilitySource: "stub",
      capabilities: ["completion"],
      family: "qwen",
      families: ["qwen"]
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
      capabilitySource: "show",
      capabilities: ["completion"],
      family: "llama",
      families: ["llama"]
    }
  ]);
});

test("GET /internal/provider/models omits Cloudflare headers when they are not configured", async () => {
  let seenHeaders: Headers | undefined;

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "",
      cfAccessClientSecret: "",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "https://example-ollama.test/api/tags") {
        seenHeaders = new Headers(init?.headers);

        return new Response(
          JSON.stringify({
            models: []
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
  assert.equal(seenHeaders?.has("CF-Access-Client-Id"), false);
  assert.equal(seenHeaders?.has("CF-Access-Client-Secret"), false);
});

test("GET /internal/provider/models marks ambiguous models as non-chat when show metadata is unavailable", async () => {
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
        return new Response(
          JSON.stringify({
            models: [
              {
                name: "qwen2.5-coder:7b",
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
        assert.equal(init?.method, "POST");

        return new Response("show unavailable", {
          status: 503,
          headers: {
            "content-type": "text/plain"
          }
        });
      }

      throw new Error(`Unhandled fetch for ${String(input)}`);
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/provider/models"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models, [
    {
      name: "qwen2.5-coder:7b",
      modifiedAt: "2026-04-20T18:00:00Z",
      size: 123,
      chatCapable: false,
      capabilitySource: "unknown",
      capabilities: [],
      exclusionReason: "missing_capability_metadata",
      families: []
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
  assert.match(forwardedBody, /"format":"json"/);
  assert.match(forwardedBody, /"think":false/);
  assert.equal(response.json().title.length <= 24, true);
  assert.equal(response.json().title, "Fix nginx config and");
});

test("POST /internal/provider/chat/title falls back to the prompt when upstream title generation fails", async () => {
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
      new Response("model refused", {
        status: 500,
        headers: {
          "content-type": "text/plain"
        }
      })
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
          content: "Please help me debug nginx proxy headers"
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title, "help me debug nginx");
});

test("POST /internal/provider/chat/title ignores malformed json-ish title output and falls back to the prompt", async () => {
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
      new Response(
        JSON.stringify({
          message: {
            content: '{"tlte":"create ascii"'
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
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
          content: "Make me some ascii art"
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title, "Make me some ascii art");
});

test("GET /internal/provider/runtime reports resident and fast-path models", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 2
  });

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 2,
      queuePromptAfterMs: 12_000,
      runtimeStatusTtlMs: 60_000,
      podInstanceId: "pod-runtime"
    },
    coordinationStore: coordinator,
    fetchImpl: async (input) => {
      assert.equal(String(input), "https://example-ollama.test/api/ps");

      return new Response(
        JSON.stringify({
          models: [
            {
              name: "gemma4"
            },
            {
              name: "qwen2.5-coder:7b"
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
    url: "/internal/provider/runtime"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    busy: false,
    activeRequests: 0,
    maxParallelRequests: 2,
    queueDepth: 0,
    residentModels: ["gemma4", "qwen2.5-coder:7b"],
    fastPathModels: ["gemma4", "qwen2.5-coder:7b"],
    fetchedAt: response.json().fetchedAt
  });
});

test("POST /internal/provider/models/warm skips when requests are already running", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });
  const release = createDeferred<void>();
  let chatCalls = 0;

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 12_000,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-warm-busy"
    },
    coordinationStore: coordinator,
    fetchImpl: async (input, init) => {
      if (String(input) === "https://example-ollama.test/api/ps") {
        return new Response(JSON.stringify({ models: [] }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (String(input) === "https://example-ollama.test/api/chat") {
        chatCalls += 1;

        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `${JSON.stringify({ message: { content: "Working..." }, done: false })}\n`
              )
            );
            await release.promise;
            controller.enqueue(
              new TextEncoder().encode(`${JSON.stringify({ done: true, done_reason: "stop" })}\n`)
            );
            controller.close();
          }
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson"
          }
        });
      }

      throw new Error(`Unhandled request ${String(input)} with method ${String(init?.method ?? "GET")}`);
    }
  });

  const streamPromise = app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_busy",
      model: "gemma4",
      messages: [{ role: "user", content: "Hello" }]
    }
  });

  await waitFor(() => chatCalls === 1);

  const warmResponse = await app.inject({
    method: "POST",
    url: "/internal/provider/models/warm",
    payload: {
      model: "qwen2.5-coder:7b"
    }
  });

  assert.equal(warmResponse.statusCode, 200);
  assert.equal(warmResponse.json().status, "skipped_busy");
  assert.equal(warmResponse.json().ready, false);

  release.resolve();
  await streamPromise;
});
