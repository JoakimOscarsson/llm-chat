import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("renders discovered models from the gateway", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "llama3.1:8b",
              modifiedAt: "2026-04-20T18:00:00Z",
              size: 123
            },
            {
              name: "qwen2.5:7b",
              modifiedAt: "2026-04-20T18:01:00Z",
              size: 456
            }
          ],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [
            {
              id: "sess_1",
              title: "Troubleshooting nginx config",
              model: "llama3.1:8b",
              updatedAt: "2026-04-20T18:03:00Z"
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

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: {
            chatService: "ok",
            modelService: "ok",
            sessionService: "ok",
            metricsService: "degraded"
          }
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: /model selector/i })).toHaveValue("llama3.1:8b");
  });

  expect(screen.getByRole("option", { name: "llama3.1:8b" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "qwen2.5:7b" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /troubleshooting nginx config/i })).toBeInTheDocument();
  expect(screen.getByText("Gateway ready")).toBeInTheDocument();
  expect(screen.getByText("Metrics degraded")).toBeInTheDocument();
  expect(screen.getByText("Pick a model, send a prompt, and the conversation will build here.")).toBeInTheDocument();
  expect(screen.queryByText("How should this chat app be structured?")).not.toBeInTheDocument();
});

test("loads and saves app defaults and session overrides", async () => {
  const requests: Array<{ url: string; body: string }> = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Troubleshooting nginx config", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/settings/defaults")) {
      if (init?.method === "PUT") {
        requests.push({ url, body: String(init.body ?? "") });
        return new Response(String(init.body ?? ""), { headers: { "content-type": "application/json" } });
      }

      return new Response(
        JSON.stringify({
          defaults: {
            systemPrompt: "Use markdown.",
            requestHistoryCount: 4,
            responseHistoryCount: 3,
            streamThinking: true,
            persistSessions: true,
            options: {
              temperature: 0.4,
              top_k: 40,
              top_p: 0.9,
              repeat_penalty: 1.05,
              num_ctx: 4096,
              num_predict: 256,
              stop: []
            }
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      if (init?.method === "PATCH") {
        requests.push({ url, body: String(init.body ?? "") });
        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              title: "Troubleshooting nginx config",
              model: "qwen2.5-coder:7b",
              createdAt: "2026-04-20T18:00:00.000Z",
              updatedAt: "2026-04-20T18:03:00.000Z",
              messages: [],
              overrides: {
                systemPrompt: "Focus on code.",
                requestHistoryCount: 2,
                temperature: 0.2
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages: [],
            overrides: {}
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  expect(await screen.findByDisplayValue("Use markdown.")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("System prompt"), {
    target: { value: "Use bullets." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

  await waitFor(() => {
    expect(requests.some((request) => request.url.endsWith("/api/settings/defaults"))).toBe(true);
  });

  fireEvent.change(screen.getByRole("combobox", { name: /model selector/i }), {
    target: { value: "llama3.1:8b" }
  });
  fireEvent.change(screen.getByLabelText("System prompt override"), {
    target: { value: "Focus on code." }
  });
  fireEvent.change(screen.getByLabelText("Request history override"), {
    target: { value: "2" }
  });
  fireEvent.change(screen.getByLabelText("Temperature override"), {
    target: { value: "0.2" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save session" }));

  await waitFor(() => {
    expect(requests.some((request) => request.url.endsWith("/api/sessions/sess_1"))).toBe(true);
  });

  expect(requests.find((request) => request.url.endsWith("/api/settings/defaults"))?.body).toContain('"systemPrompt":"Use bullets."');
  expect(requests.find((request) => request.url.endsWith("/api/sessions/sess_1"))?.body).toContain('"requestHistoryCount":2');
});

test("clears transcript history for the active session", async () => {
  const requests: string[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Troubleshooting nginx config", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/settings/defaults")) {
      return new Response(
        JSON.stringify({
          defaults: {
            systemPrompt: "Use markdown.",
            requestHistoryCount: 4,
            responseHistoryCount: 3,
            streamThinking: true,
            persistSessions: true,
            options: {
              temperature: 0.4,
              top_k: 40,
              top_p: 0.9,
              repeat_penalty: 1.05,
              num_ctx: 4096,
              num_predict: 256,
              stop: []
            }
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1/history")) {
      requests.push(url);
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:04:00.000Z",
            messages: [],
            overrides: {}
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages: [
              {
                id: "msg_1",
                role: "user",
                content: "Count to 10.",
                createdAt: "2026-04-20T18:03:00.000Z"
              },
              {
                id: "msg_2",
                role: "assistant",
                content: "1 2 3 4 5 6 7 8 9 10",
                createdAt: "2026-04-20T18:03:05.000Z",
                thinking: {
                  content: "Continue the counting sequence cleanly.",
                  collapsedByDefault: true
                }
              }
            ],
            overrides: {}
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  await screen.findByText("Count to 10.");
  expect(screen.getByText("1 2 3 4 5 6 7 8 9 10")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear history" }));

  await waitFor(() => {
    expect(requests).toContain("/api/sessions/sess_1/history");
  });

  expect(screen.queryByText("Count to 10.")).not.toBeInTheDocument();
  expect(screen.getByText("Pick a model, send a prompt, and the conversation will build here.")).toBeInTheDocument();
  expect(screen.getByText("History cleared")).toBeInTheDocument();
});

test("streams thinking and markdown response into the UI as chunks arrive", async () => {
  const encoder = new TextEncoder();
  let streamController: { enqueue(chunk: Uint8Array): void; close(): void } | null = null;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Troubleshooting nginx config", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      expect(init?.method).toBe("POST");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: {
            "content-type": "text/event-stream"
          }
        }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  const { container } = render(<App />);

  await screen.findByRole("button", { name: /troubleshooting nginx config/i });

  fireEvent.change(screen.getByPlaceholderText("Send a message to the model..."), {
    target: { value: "Hello" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  expect(screen.getByPlaceholderText("Send a message to the model...")).toHaveValue("");
  expect(screen.getByText("Sending prompt to llama3.1:8b...")).toBeInTheDocument();
  expect(screen.getByText("Hello")).toBeInTheDocument();
  expect(screen.getByText("Waiting for answer...")).toBeInTheDocument();

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const controller = streamController as { enqueue(chunk: Uint8Array): void; close(): void };

  controller.enqueue(encoder.encode('event: meta\ndata: {"requestId":"req_1","model":"llama3.1:8b"}\n\n'));
  controller.enqueue(encoder.encode('event: thinking_delta\ndata: {"text":"Thinking..."}\n\n'));

  await waitFor(() => {
    expect(screen.getByText("Streaming reasoning...")).toBeInTheDocument();
    expect(container.querySelector(".thinking-box")).toHaveTextContent("Thinking...");
  });

  expect(screen.queryByText("Hello there")).not.toBeInTheDocument();

  controller.enqueue(encoder.encode('event: response_delta\ndata: {"text":"# Hello there\\n\\n- First point"}\n\n'));
  controller.enqueue(encoder.encode('event: done\ndata: {"finishReason":"stop"}\n\n'));
  controller.close();

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Hello there" })).toBeInTheDocument();
  });
  expect(screen.getByText("First point")).toBeInTheDocument();
  expect(screen.getByText("Complete")).toBeInTheDocument();
});

test("uses the currently selected model and surfaces stream errors", async () => {
  const encoder = new TextEncoder();
  let streamController: { enqueue(chunk: Uint8Array): void; close(): void } | null = null;
  const chatRequests: string[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: "gemma4:12b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 },
            { name: "qwen2.5-coder:7b", modifiedAt: "2026-04-20T18:02:00Z", size: 456 }
          ],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(JSON.stringify({ sessions: [] }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      chatRequests.push(String(init?.body ?? ""));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: {
            "content-type": "text/event-stream"
          }
        }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: /model selector/i })).toHaveValue("gemma4:12b");
  });

  fireEvent.change(screen.getByRole("combobox", { name: /model selector/i }), {
    target: { value: "qwen2.5-coder:7b" }
  });
  fireEvent.change(screen.getByPlaceholderText("Send a message to the model..."), {
    target: { value: "Switch models" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  await waitFor(() => {
    expect(chatRequests).toHaveLength(1);
  });
  expect(chatRequests[0]).toContain('"model":"qwen2.5-coder:7b"');

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const controller = streamController as { enqueue(chunk: Uint8Array): void; close(): void };
  controller.enqueue(encoder.encode('event: meta\ndata: {"requestId":"req_1","model":"qwen2.5-coder:7b"}\n\n'));
  controller.enqueue(
    encoder.encode(
      'event: error\ndata: {"requestId":"req_1","model":"qwen2.5-coder:7b","message":"model not found","status":404}\n\n'
    )
  );
  controller.close();

  await waitFor(() => {
    expect(screen.getByText("Request failed")).toBeInTheDocument();
  });
  expect(screen.getByText(/request failed while using/i)).toBeInTheDocument();
  expect(screen.getAllByText(/model not found/i)).toHaveLength(2);
});

test("shows a non-thinking notice while still streaming the response", async () => {
  const encoder = new TextEncoder();
  let streamController: { enqueue(chunk: Uint8Array): void; close(): void } | null = null;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.2:3b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(JSON.stringify({ sessions: [] }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      expect(init?.method).toBe("POST");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        {
          headers: {
            "content-type": "text/event-stream"
          }
        }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.change(await screen.findByPlaceholderText("Send a message to the model..."), {
    target: { value: "Hello" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const controller = streamController as { enqueue(chunk: Uint8Array): void; close(): void };
  controller.enqueue(encoder.encode('event: meta\ndata: {"requestId":"req_1","model":"llama3.2:3b"}\n\n'));
  controller.enqueue(
    encoder.encode(
      'event: thinking_unavailable\ndata: {"text":"This model does not stream a separate thinking trace."}\n\n'
    )
  );
  controller.enqueue(encoder.encode('event: response_delta\ndata: {"text":"Plain response"}\n\n'));
  controller.enqueue(encoder.encode('event: done\ndata: {"finishReason":"stop"}\n\n'));
  controller.close();

  await waitFor(() => {
    expect(screen.getByText("Plain response")).toBeInTheDocument();
  });
  expect(screen.getAllByText("This model does not stream a separate thinking trace.")).toHaveLength(2);
  expect(screen.getByText("Complete")).toBeInTheDocument();
});

test("shows unsupported settings notices while continuing the response stream", async () => {
  const encoder = new TextEncoder();
  let streamController: { enqueue(chunk: Uint8Array): void; close(): void } | null = null;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Troubleshooting nginx config", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages: [],
            overrides: {}
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/settings/defaults")) {
      return new Response(
        JSON.stringify({
          defaults: {
            systemPrompt: "Use markdown.",
            requestHistoryCount: 4,
            responseHistoryCount: 3,
            streamThinking: true,
            persistSessions: true,
            options: {
              temperature: 0.4,
              top_k: 40,
              top_p: 0.9,
              repeat_penalty: 1.05,
              num_ctx: 4096,
              num_predict: 256,
              stop: []
            }
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      expect(init?.method).toBe("POST");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          }
        }),
        { headers: { "content-type": "text/event-stream" } }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.change(await screen.findByPlaceholderText("Send a message to the model..."), {
    target: { value: "Hello" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const controller = streamController as { enqueue(chunk: Uint8Array): void; close(): void };
  controller.enqueue(encoder.encode('event: meta\ndata: {"requestId":"req_1","model":"llama3.1:8b"}\n\n'));
  controller.enqueue(
    encoder.encode(
      'event: settings_notice\ndata: {"option":"top_k","text":"This model does not support the top_k setting. Retrying without it."}\n\n'
    )
  );
  controller.enqueue(encoder.encode('event: response_delta\ndata: {"text":"Recovered answer"}\n\n'));
  controller.enqueue(encoder.encode('event: done\ndata: {"finishReason":"stop"}\n\n'));
  controller.close();

  await waitFor(() => {
    expect(screen.getByText("Recovered answer")).toBeInTheDocument();
  });
  expect(screen.getByText("This model does not support the top_k setting. Retrying without it.")).toBeInTheDocument();
});

test("pressing Enter sends while Shift+Enter inserts a newline", async () => {
  const chatRequests: string[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Troubleshooting nginx config", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      chatRequests.push(String(init?.body ?? ""));
      return new Response('event: done\ndata: {"finishReason":"stop"}\n\n', {
        headers: {
          "content-type": "text/event-stream"
        }
      });
    }

    if (url.endsWith("/api/chat/stop")) {
      return new Response(JSON.stringify({ stopped: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  const input = await screen.findByPlaceholderText("Send a message to the model...");

  fireEvent.change(input, {
    target: { value: "Line one" }
  });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });

  expect(screen.getByPlaceholderText("Send a message to the model...")).toHaveValue("Line one\n");
  expect(chatRequests).toHaveLength(0);

  fireEvent.keyDown(screen.getByPlaceholderText("Send a message to the model..."), {
    key: "Enter",
    code: "Enter"
  });

  await waitFor(() => {
    expect(chatRequests).toHaveLength(1);
  });
  expect(chatRequests[0]).toContain('"message":"Line one"');
  expect(chatRequests[0]).toContain('"sessionId":"sess_1"');
});

test("stops an in-flight stream and sends a stop request", async () => {
  let stopRequested = false;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 }],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Troubleshooting nginx config", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api-gateway",
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "degraded" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      expect(init?.method).toBe("POST");

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: meta\ndata: {"requestId":"req_1","model":"llama3.1:8b"}\n\n'));
          }
        }),
        {
          headers: {
            "content-type": "text/event-stream"
          }
        }
      );
    }

    if (url.endsWith("/api/chat/stop")) {
      stopRequested = true;

      return new Response(JSON.stringify({ stopped: true, requestId: "req_1" }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  await screen.findByRole("button", { name: /troubleshooting nginx config/i });

  fireEvent.change(screen.getByPlaceholderText("Send a message to the model..."), {
    target: { value: "Hello" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  await screen.findByRole("button", { name: "Stop" });
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));

  await waitFor(() => {
    expect(stopRequested).toBe(true);
  });

  expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
});
