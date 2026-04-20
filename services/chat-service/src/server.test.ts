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

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), "http://ollama-adapter:4005/internal/provider/chat/stream");

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
});

test("POST /internal/chat/stop aborts an in-flight stream and forwards the stop request", async () => {
  let aborted = false;
  let stopForwarded = false;

  const app = createApp({
    config: {
      port: 4001,
      sessionServiceUrl: "http://session-service:4003",
      ollamaAdapterUrl: "http://ollama-adapter:4005"
    },
    fetchImpl: async (input, init) => {
      if (String(input) === "http://ollama-adapter:4005/internal/provider/chat/stream") {
        const signal = init?.signal as AbortSignal | undefined;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }

      if (String(input) === "http://ollama-adapter:4005/internal/provider/chat/stop") {
        stopForwarded = true;

        return new Response(JSON.stringify({ stopped: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`Unexpected url: ${String(input)}`);
    }
  });

  const streamPromise = app.inject({
    method: "POST",
    url: "/internal/chat/stream",
    payload: {
      requestId: "req_1",
      model: "llama3.1:8b",
      message: "Hello"
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const stopResponse = await app.inject({
    method: "POST",
    url: "/internal/chat/stop",
    payload: {
      requestId: "req_1"
    }
  });

  const streamResponse = await streamPromise;

  assert.equal(stopResponse.statusCode, 200);
  assert.deepEqual(stopResponse.json(), {
    stopped: true,
    requestId: "req_1"
  });
  assert.equal(streamResponse.statusCode, 499);
  assert.equal(aborted, true);
  assert.equal(stopForwarded, true);
});
