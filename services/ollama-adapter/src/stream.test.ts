import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";
import { InMemoryQueueCoordinator } from "./coordination.js";
import { createDeferred, waitFor } from "./test-helpers.js";

test("POST /internal/provider/chat/stream returns stub thinking and response events", async () => {
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
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      model: "llama3.1:8b",
      message: "Hello"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: meta/);
  assert.match(response.body, /event: thinking_delta/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /event: done/);
});

test("POST /internal/provider/chat/stream applies queue coordination even when stub mode is enabled", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });

  const appOne = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: true,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 25,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-one",
      stubResponseDelayMs: 150
    },
    coordinationStore: coordinator
  });
  const appTwo = createApp({
    config: {
      port: 4006,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: true,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 25,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-two",
      stubResponseDelayMs: 150
    },
    coordinationStore: coordinator
  });

  const firstResponsePromise = appOne.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "llama3.1:8b",
      messages: [{ role: "user", content: "First" }]
    }
  });

  await waitFor(async () => (await coordinator.getRequestSnapshot("req_1"))?.state === "running");

  const secondResponsePromise = appTwo.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_2",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Second" }]
    }
  });

  await waitFor(async () => (await coordinator.getRequestSnapshot("req_2"))?.state === "queued");

  const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise]);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.match(secondResponse.body, /event: queued/);
  assert.match(secondResponse.body, /event: queue_prompt/);
  assert.match(secondResponse.body, /event: started/);
  assert.match(secondResponse.body, /Hello there/);
});

test("POST /internal/provider/chat/stop acknowledges a stop request", async () => {
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
    method: "POST",
    url: "/internal/provider/chat/stop",
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

test("POST /internal/provider/models/warm preloads a model through generate", async () => {
  let forwardedHeaders: Record<string, string> | undefined;
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
      assert.equal(String(input), "https://example-ollama.test/api/generate");
      forwardedHeaders = init?.headers as Record<string, string> | undefined;
      forwardedBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          model: "qwen2.5-coder:7b",
          done: true,
          load_duration: 125_000_000,
          total_duration: 130_000_000
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
    url: "/internal/provider/models/warm",
    payload: {
      model: "qwen2.5-coder:7b",
      keep_alive: -1
    }
  });

  assert.equal(response.statusCode, 200);
  assert.ok(forwardedHeaders);
  assert.equal(forwardedHeaders?.["CF-Access-Client-Id"], "client-id");
  assert.equal(forwardedHeaders?.["CF-Access-Client-Secret"], "client-secret");
  assert.match(forwardedBody, /"prompt":""/);
  assert.match(forwardedBody, /"stream":false/);
  assert.match(forwardedBody, /"keep_alive":-1/);
  assert.equal(response.json().status, "warmed");
  assert.equal(response.json().ready, true);
  assert.equal(response.json().model, "qwen2.5-coder:7b");
  assert.equal(response.json().loadDuration, 125_000_000);
});

test("GET /internal/provider/models enriches tags with capabilities from show", async () => {
  const requests: string[] = [];

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
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);

      if (String(input) === "https://example-ollama.test/api/tags") {
        return new Response(
          JSON.stringify({
            models: [
              {
                name: "llama3.1:8b",
                modified_at: "2026-04-20T18:00:00Z",
                size: 123,
                details: {
                  family: "llama",
                  families: ["llama"]
                }
              },
              {
                name: "embeddinggemma",
                modified_at: "2026-04-20T18:01:00Z",
                size: 456,
                details: {
                  family: "embeddinggemma",
                  families: ["embeddinggemma"]
                }
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
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };

        if (body.model === "llama3.1:8b") {
          return new Response(
            JSON.stringify({
              capabilities: ["completion"],
              details: {
                family: "llama",
                families: ["llama"]
              }
            }),
            {
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            capabilities: ["embedding"],
            details: {
              family: "embeddinggemma",
              families: ["embeddinggemma"]
            }
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      throw new Error(`Unhandled request: ${String(input)}`);
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/provider/models"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requests.filter((entry) => entry === "POST https://example-ollama.test/api/show").length, 2);
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
    },
    {
      name: "embeddinggemma",
      modifiedAt: "2026-04-20T18:01:00Z",
      size: 456,
      chatCapable: false,
      capabilitySource: "show",
      capabilities: ["embedding"],
      exclusionReason: "embedding",
      family: "embeddinggemma",
      families: ["embeddinggemma"]
    }
  ]);
});

test("POST /internal/provider/chat/stream normalizes a real Ollama NDJSON stream", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "qwen3:8b",
      message: {
        role: "assistant",
        thinking: "Consider the problem."
      },
      done: false
    }),
    JSON.stringify({
      model: "qwen3:8b",
      message: {
        role: "assistant",
        content: "Here is the answer."
      },
      done: false
    }),
    JSON.stringify({
      model: "qwen3:8b",
      done: true,
      done_reason: "stop",
      total_duration: 100,
      load_duration: 20,
      prompt_eval_count: 10,
      prompt_eval_duration: 30,
      eval_count: 5,
      eval_duration: 50
    })
  ].join("\n");

  let forwardedHeaders: Record<string, string> | undefined;
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
      forwardedHeaders = init?.headers as Record<string, string> | undefined;
      forwardedBody = String(init?.body ?? "");

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "qwen3:8b",
      messages: [{ role: "user", content: "Hello" }],
      streamThinking: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: meta/);
  assert.match(response.body, /event: thinking_delta/);
  assert.match(response.body, /Consider the problem/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /Here is the answer/);
  assert.match(response.body, /event: usage/);
  assert.match(response.body, /event: done/);
  assert.ok(forwardedHeaders);
  assert.equal(forwardedHeaders?.["CF-Access-Client-Id"], "client-id");
  assert.equal(forwardedHeaders?.["CF-Access-Client-Secret"], "client-secret");
  assert.match(forwardedBody, /"stream":true/);
  assert.match(forwardedBody, /"messages":\[/);
});

test("POST /internal/provider/chat/stream includes model details in upstream error events", async () => {
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
      new Response("model not found", {
        status: 404,
        headers: {
          "content-type": "text/plain"
        }
      })
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_404",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Hello" }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /event: error/);
  assert.match(response.body, /qwen2\.5-coder:7b/);
  assert.match(response.body, /model not found/);
  assert.match(response.body, /"status":404/);
});

test("POST /internal/provider/chat/stream falls back when thinking is unsupported", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "llama3.2:3b",
      message: {
        role: "assistant",
        content: "Plain response."
      },
      done: false
    }),
    JSON.stringify({
      model: "llama3.2:3b",
      done: true,
      done_reason: "stop"
    })
  ].join("\n");

  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      if (requestBodies.length === 1) {
        return new Response("thinking not supported for this model", {
          status: 400,
          headers: {
            "content-type": "text/plain"
          }
        });
      }

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_retry",
      model: "llama3.2:3b",
      messages: [{ role: "user", content: "Hello" }],
      streamThinking: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0] ?? "", /"think":true/);
  assert.doesNotMatch(requestBodies[1] ?? "", /"think":true/);
  assert.match(response.body, /event: thinking_unavailable/);
  assert.match(response.body, /does not support thinking/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /Plain response/);
  assert.match(response.body, /event: done/);
});

test("POST /internal/provider/chat/stream falls back for Ollama JSON thinking errors", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "qwen2.5-coder:7b",
      message: {
        role: "assistant",
        content: "Streaming without a separate reasoning trace."
      },
      done: false
    }),
    JSON.stringify({
      model: "qwen2.5-coder:7b",
      done: true,
      done_reason: "stop"
    })
  ].join("\n");

  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: "\"qwen2.5-coder:7b\" does not support thinking" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_qwen_retry",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Hello" }],
      streamThinking: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0] ?? "", /"think":true/);
  assert.doesNotMatch(requestBodies[1] ?? "", /"think":true/);
  assert.match(response.body, /event: thinking_unavailable/);
  assert.match(response.body, /qwen2\.5-coder:7b/);
  assert.match(response.body, /event: response_delta/);
  assert.match(response.body, /Streaming without a separate reasoning trace/);
  assert.doesNotMatch(response.body, /event: error/);
});

test("POST /internal/provider/chat/stream retries without unsupported options", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "llama3.1:8b",
      message: {
        role: "assistant",
        content: "Recovered response."
      },
      done: false
    }),
    JSON.stringify({
      model: "llama3.1:8b",
      done: true,
      done_reason: "stop"
    })
  ].join("\n");
  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: "unsupported option: top_k" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_option_retry",
      model: "llama3.1:8b",
      messages: [{ role: "user", content: "Hello" }],
      options: {
        temperature: 0.7,
        top_k: 40,
        num_ctx: 4096
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0] ?? "", /"top_k":40/);
  assert.doesNotMatch(requestBodies[1] ?? "", /"top_k":40/);
  assert.match(response.body, /event: settings_notice/);
  assert.match(response.body, /top_k/);
  assert.match(response.body, /Recovered response/);
  assert.doesNotMatch(response.body, /event: error/);
});

test("POST /internal/provider/chat/stream retries through multiple unsupported options", async () => {
  const upstreamBody = [
    JSON.stringify({
      model: "llama3.1:8b",
      message: {
        role: "assistant",
        content: "Recovered after multiple downgrades."
      },
      done: false
    }),
    JSON.stringify({
      model: "llama3.1:8b",
      done: true,
      done_reason: "stop"
    })
  ].join("\n");
  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: "unsupported option: top_k" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (requestBodies.length === 2) {
        return new Response(JSON.stringify({ error: "unsupported option: num_ctx" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      return new Response(upstreamBody, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_option_retry_chain",
      model: "llama3.1:8b",
      messages: [{ role: "user", content: "Hello" }],
      options: {
        temperature: 0.7,
        top_k: 40,
        num_ctx: 4096
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 3);
  assert.match(requestBodies[0] ?? "", /"top_k":40/);
  assert.match(requestBodies[0] ?? "", /"num_ctx":4096/);
  assert.doesNotMatch(requestBodies[1] ?? "", /"top_k":40/);
  assert.match(requestBodies[1] ?? "", /"num_ctx":4096/);
  assert.doesNotMatch(requestBodies[2] ?? "", /"top_k":40/);
  assert.doesNotMatch(requestBodies[2] ?? "", /"num_ctx":4096/);
  assert.match(response.body, /event: settings_notice/);
  assert.match(response.body, /top_k/);
  assert.match(response.body, /num_ctx/);
  assert.match(response.body, /Recovered after multiple downgrades/);
  assert.doesNotMatch(response.body, /event: error/);
});

test("POST /internal/provider/chat/stream fails cleanly when unsupported-option retries stop making progress", async () => {
  const requestBodies: string[] = [];

  const app = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false
    },
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));

      return new Response(JSON.stringify({ error: "unsupported option: top_k" }), {
        status: 400,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_option_retry_stall",
      model: "llama3.1:8b",
      messages: [{ role: "user", content: "Hello" }],
      options: {
        top_k: 40
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestBodies.length, 2);
  assert.match(response.body, /event: settings_notice/);
  assert.match(response.body, /top_k/);
  assert.match(response.body, /event: error/);
  assert.match(response.body, /unsupported option: top_k/);
});

test("POST /internal/provider/chat/stream queues later requests when the cluster-wide limit is 1", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });
  const releaseFirst = createDeferred<void>();
  const requestBodies: string[] = [];
  let chatCalls = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://example-ollama.test/api/chat");
    chatCalls += 1;
    requestBodies.push(String(init?.body ?? ""));
    const signal = init?.signal;
    const encoder = new TextEncoder();

    if (chatCalls === 1) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ message: { content: "First response." }, done: false })}\n`)
          );
          signal?.addEventListener(
            "abort",
            () => {
              controller.error(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
          void releaseFirst.promise.then(() => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ done: true, done_reason: "stop" })}\n`));
            controller.close();
          });
        }
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }

    return new Response(
      [
        JSON.stringify({ message: { content: "Second response." }, done: false }),
        JSON.stringify({ done: true, done_reason: "stop" })
      ].join("\n"),
      {
        headers: {
          "content-type": "application/x-ndjson"
        }
      }
    );
  };

  const appOne = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 50,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-one"
    },
    coordinationStore: coordinator,
    fetchImpl
  });
  const appTwo = createApp({
    config: {
      port: 4006,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 50,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-two"
    },
    coordinationStore: coordinator,
    fetchImpl
  });

  const firstResponsePromise = appOne.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "gemma4",
      messages: [{ role: "user", content: "First" }]
    }
  });

  await waitFor(() => chatCalls === 1);

  const secondResponsePromise = appTwo.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_2",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Second" }]
    }
  });

  await waitFor(() => {
    const snapshotPromise = coordinator.getRequestSnapshot("req_2");
    return snapshotPromise.then((snapshot) => snapshot?.state === "queued").catch(() => false);
  }).catch(async () => {
    const snapshot = await coordinator.getRequestSnapshot("req_2");
    assert.equal(snapshot?.state, "queued");
  });

  assert.equal(chatCalls, 1);

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 80);
  });

  releaseFirst.resolve();

  const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise]);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(chatCalls, 2);
  assert.match(secondResponse.body, /event: queued/);
  assert.match(secondResponse.body, /event: queue_prompt/);
  assert.match(secondResponse.body, /event: started/);
  assert.match(secondResponse.body, /Second response\./);
  assert.match(requestBodies[1] ?? "", /"model":"qwen2.5-coder:7b"/);
});

test("POST /internal/provider/chat/stream enforces a cluster-wide limit greater than one", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 2
  });
  const release = [createDeferred<void>(), createDeferred<void>()];
  let chatCalls = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://example-ollama.test/api/chat");
    const callIndex = chatCalls;
    chatCalls += 1;
    const encoder = new TextEncoder();

    if (callIndex < 2) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ message: { content: `Running ${callIndex + 1}` }, done: false })}\n`)
          );
          void release[callIndex]?.promise.then(() => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ done: true, done_reason: "stop" })}\n`));
            controller.close();
          });
        }
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }

    return new Response(
      [
        JSON.stringify({ message: { content: "Queued third" }, done: false }),
        JSON.stringify({ done: true, done_reason: "stop" })
      ].join("\n"),
      {
        headers: {
          "content-type": "application/x-ndjson"
        }
      }
    );
  };

  const makeApp = (podInstanceId: string, port: number) =>
    createApp({
      config: {
        port,
        ollamaBaseUrl: "https://example-ollama.test",
        cfAccessClientId: "client-id",
        cfAccessClientSecret: "client-secret",
        ollamaTimeoutMs: 60_000,
        useStub: false,
        redisUrl: "",
        maxParallelRequests: 2,
        queuePromptAfterMs: 50,
        runtimeStatusTtlMs: 0,
        podInstanceId
      },
      coordinationStore: coordinator,
      fetchImpl
    });

  const appOne = makeApp("pod-a", 4005);
  const appTwo = makeApp("pod-b", 4006);
  const appThree = makeApp("pod-c", 4007);

  const first = appOne.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "gemma4",
      messages: [{ role: "user", content: "One" }]
    }
  });
  const second = appTwo.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_2",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Two" }]
    }
  });

  await waitFor(() => chatCalls === 2);

  const third = appThree.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_3",
      model: "llama3.1:8b",
      messages: [{ role: "user", content: "Three" }]
    }
  });

  await waitFor(async () => (await coordinator.getRequestSnapshot("req_3"))?.state === "queued");
  const queuedSnapshot = await coordinator.getRequestSnapshot("req_3");
  assert.equal(queuedSnapshot?.state, "queued");
  assert.equal(chatCalls, 2);

  release[0].resolve();
  release[1].resolve();

  const thirdResponse = await third;
  await first;
  await second;

  assert.equal(chatCalls, 3);
  assert.match(thirdResponse.body, /event: queued/);
  assert.match(thirdResponse.body, /Queued third/);
});

test("POST /internal/provider/chat/stop cancels queued requests without starting them", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });
  const release = createDeferred<void>();
  let chatCalls = 0;

  const fetchImpl: typeof fetch = async (input) => {
    assert.equal(String(input), "https://example-ollama.test/api/chat");
    chatCalls += 1;

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`${JSON.stringify({ message: { content: "First response." }, done: false })}\n`)
        );
        await release.promise;
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ done: true, done_reason: "stop" })}\n`));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson"
      }
    });
  };

  const appOne = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 25,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-one"
    },
    coordinationStore: coordinator,
    fetchImpl
  });
  const appTwo = createApp({
    config: {
      port: 4006,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 25,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-two"
    },
    coordinationStore: coordinator,
    fetchImpl
  });

  const first = appOne.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "gemma4",
      messages: [{ role: "user", content: "One" }]
    }
  });

  await waitFor(() => chatCalls === 1);

  const second = appTwo.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_2",
      model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Two" }]
    }
  });

  await waitFor(async () => (await coordinator.getRequestSnapshot("req_2"))?.state === "queued");

  const stopResponse = await appOne.inject({
    method: "POST",
    url: "/internal/provider/chat/stop",
    payload: {
      requestId: "req_2"
    }
  });

  assert.equal(stopResponse.statusCode, 200);
  assert.deepEqual(stopResponse.json(), {
    stopped: true,
    requestId: "req_2"
  });

  release.resolve();

  const secondResponse = await second;
  await first;

  assert.equal(chatCalls, 1);
  assert.match(secondResponse.body, /queued_cancelled/);
});

test("POST /internal/provider/chat/stop aborts running requests across pods", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });
  let abortSeen = false;

  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://example-ollama.test/api/chat");
    const signal = init?.signal;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ message: { content: "Streaming..." }, done: false })}\n`)
        );
        signal?.addEventListener(
          "abort",
          () => {
            abortSeen = true;
            controller.error(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          },
          { once: true }
        );
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson"
      }
    });
  };

  const appOne = createApp({
    config: {
      port: 4005,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 50,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-one"
    },
    coordinationStore: coordinator,
    fetchImpl
  });
  const appTwo = createApp({
    config: {
      port: 4006,
      ollamaBaseUrl: "https://example-ollama.test",
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
      ollamaTimeoutMs: 60_000,
      useStub: false,
      redisUrl: "",
      maxParallelRequests: 1,
      queuePromptAfterMs: 50,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-two"
    },
    coordinationStore: coordinator,
    fetchImpl
  });

  const streamResponsePromise = appOne.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "gemma4",
      messages: [{ role: "user", content: "Cancel me" }]
    }
  });

  await waitFor(async () => (await coordinator.getRequestSnapshot("req_1"))?.state === "running");

  const stopResponse = await appTwo.inject({
    method: "POST",
    url: "/internal/provider/chat/stop",
    payload: {
      requestId: "req_1"
    }
  });

  assert.equal(stopResponse.statusCode, 200);

  const streamResponse = await streamResponsePromise;

  assert.equal(abortSeen, true);
  assert.match(streamResponse.body, /"finishReason":"cancelled"/);
});

test("PATCH /internal/provider/chat/requests/:requestId retargets queued requests before execution starts", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });
  const releaseFirst = createDeferred<void>();
  const requestBodies: string[] = [];
  let chatCalls = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://example-ollama.test/api/chat");
    chatCalls += 1;
    requestBodies.push(String(init?.body ?? ""));
    const encoder = new TextEncoder();

    if (chatCalls === 1) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ message: { content: "First response." }, done: false })}\n`)
          );
          void releaseFirst.promise.then(() => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ done: true, done_reason: "stop" })}\n`));
            controller.close();
          });
        }
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    }

    return new Response(
      [
        JSON.stringify({ message: { content: "Retargeted response." }, done: false }),
        JSON.stringify({ done: true, done_reason: "stop" })
      ].join("\n"),
      {
        headers: {
          "content-type": "application/x-ndjson"
        }
      }
    );
  };

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
      queuePromptAfterMs: 25,
      runtimeStatusTtlMs: 0,
      podInstanceId: "pod-one"
    },
    coordinationStore: coordinator,
    fetchImpl
  });

  const first = app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_1",
      model: "gemma4",
      messages: [{ role: "user", content: "One" }]
    }
  });

  await waitFor(() => chatCalls === 1);

  const second = app.inject({
    method: "POST",
    url: "/internal/provider/chat/stream",
    payload: {
      requestId: "req_2",
      model: "gemma4",
      messages: [{ role: "user", content: "Two" }]
    }
  });

  await waitFor(async () => (await coordinator.getRequestSnapshot("req_2"))?.state === "queued");

  const patchResponse = await app.inject({
    method: "PATCH",
    url: "/internal/provider/chat/requests/req_2",
    payload: {
      model: "qwen2.5-coder:7b"
    }
  });

  assert.equal(patchResponse.statusCode, 200);
  assert.equal(patchResponse.json().request.model, "qwen2.5-coder:7b");

  releaseFirst.resolve();

  const secondResponse = await second;
  await first;

  assert.match(secondResponse.body, /event: started/);
  assert.match(secondResponse.body, /qwen2\.5-coder:7b/);
  assert.match(requestBodies[1] ?? "", /"model":"qwen2.5-coder:7b"/);
});
