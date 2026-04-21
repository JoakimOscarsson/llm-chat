import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";

const originalInnerWidth = window.innerWidth;
const defaultAppDefaults = {
  systemPrompt: "You are a concise, helpful assistant.",
  requestHistoryCount: 8,
  responseHistoryCount: 8,
  streamThinking: true,
  persistSessions: true,
  options: {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 5120,
    stop: []
  }
};

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width
  });
  window.dispatchEvent(new Event("resize"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setWindowWidth(originalInnerWidth);
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
              model: "missing-model:latest",
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

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "missing-model:latest",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages: [],
            overrides: {}
          }
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "qwen2.5:7b",
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

    if (url.endsWith("/api/sessions/sess_1/model-switch")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "qwen2.5:7b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:05:00.000Z",
            messages: [
              {
                id: "switch_sess_1_2026-04-20T18:05:00.000Z",
                role: "system",
                content: "",
                createdAt: "2026-04-20T18:05:00.000Z",
                kind: "model_switch",
                model: "qwen2.5:7b"
              }
            ],
            overrides: {}
          }
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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

  fireEvent.click(screen.getAllByRole("button", { name: /models/i })[0]!);

  await waitFor(() => {
    expect(screen.getByRole("option", { name: /llama3.1:8b/i })).toHaveAttribute("aria-selected", "true");
  });

  fireEvent.click(screen.getAllByRole("button", { name: /expand sessions sidebar/i })[0]!);
  expect(screen.getByRole("option", { name: /llama3.1:8b/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /qwen2.5:7b/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /troubleshooting nginx config/i })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: /expand settings sidebar/i })[0]!);
  expect(screen.getAllByText("Gateway ready").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Metrics unavailable").length).toBeGreaterThan(0);
  expect(screen.getByText("Start a new conversation when you’re ready.")).toBeInTheDocument();
  expect(screen.queryByText("How should this chat app be structured?")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("option", { name: /qwen2.5:7b/i }));

  await waitFor(() => {
    expect(screen.getAllByRole("button", { name: /models/i })[0]).toHaveAttribute("aria-expanded", "false");
  });
  expect(await screen.findByText("Switched to qwen2.5:7b")).toBeInTheDocument();
});

test("disables the composer while a model switch is warming", async () => {
  let warmupResolver!: () => void;
  const warmupDone = new Promise<void>((resolve) => {
    warmupResolver = resolve;
  });

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 },
            { name: "qwen2.5:7b", modifiedAt: "2026-04-20T18:01:00Z", size: 456 }
          ],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "qwen2.5-coder:7b",
          warmedAt: "2026-04-20T18:04:00Z",
          loadDuration: 125_000_000,
          totalDuration: 130_000_000
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "New chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "New chat",
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      await warmupDone;

      return new Response(
        JSON.stringify({
          ready: true,
          model: "qwen2.5:7b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1/model-switch")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "New chat",
            model: "qwen2.5:7b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:04:00.000Z",
            messages: [
              {
                id: "switch_sess_1_2026-04-20T18:04:00.000Z",
                role: "system",
                content: "",
                createdAt: "2026-04-20T18:04:00.000Z",
                kind: "model_switch",
                model: "qwen2.5:7b"
              }
            ],
            overrides: {}
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.click(screen.getAllByRole("button", { name: /models/i })[0]!);
  fireEvent.click(await screen.findByRole("option", { name: /qwen2.5:7b/i }));

  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: /prompt/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  warmupResolver();

  await waitFor(() => {
    expect(screen.getByText("Switched to qwen2.5:7b")).toBeInTheDocument();
  });
});

test("warms the initially selected model before enabling the composer", async () => {
  let warmupResolver!: () => void;
  const warmupDone = new Promise<void>((resolve) => {
    warmupResolver = resolve;
  });
  const warmRequests: string[] = [];

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
          sessions: [{ id: "sess_1", title: "New chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "New chat",
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/settings/defaults")) {
      return new Response(JSON.stringify({ defaults: { ...defaultAppDefaults } }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.endsWith("/api/models/warm")) {
      warmRequests.push(String(init?.body ?? ""));
      await warmupDone;

      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: /prompt/i })).toBeDisabled();
  });
  expect(screen.getByText("Loading llama3.1:8b...")).toBeInTheDocument();
  expect(warmRequests).toHaveLength(1);

  warmupResolver();

  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: /prompt/i })).not.toBeDisabled();
  });
  expect(screen.getByText("llama3.1:8b ready")).toBeInTheDocument();
});

test("dismisses overlay sidebars on outside click and keeps docked rails beside the chat", async () => {
  setWindowWidth(1100);

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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
          sessions: [{ id: "sess_1", title: "Project notes", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Project notes",
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

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/settings/defaults")) {
      return new Response(JSON.stringify({ defaults: { ...defaultAppDefaults } }), {
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  expect(document.querySelector(".sidebar")).toHaveAttribute("inert");
  expect(document.querySelector(".utility-panel")).toHaveAttribute("inert");

  fireEvent.click((await screen.findAllByRole("button", { name: /expand sessions sidebar/i }))[0]!);
  expect(await screen.findByRole("button", { name: /project notes/i })).toBeInTheDocument();
  expect(document.querySelector(".sidebar")).not.toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: /close sessions sidebar/i }));

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /project notes/i })).not.toBeInTheDocument();
  });
  expect(document.querySelector(".sidebar")).toHaveAttribute("inert");

  fireEvent.click(screen.getAllByRole("button", { name: /expand settings sidebar/i })[0]!);
  expect(screen.getByRole("button", { name: /close settings sidebar/i })).toBeInTheDocument();
  expect(document.querySelector(".utility-panel")).not.toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: /close settings sidebar/i }));

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /close settings sidebar/i })).not.toBeInTheDocument();
  });
  expect(document.querySelector(".utility-panel")).toHaveAttribute("inert");

  setWindowWidth(1600);
  fireEvent.click(screen.getAllByRole("button", { name: /expand sessions sidebar/i })[0]!);

  await waitFor(() => {
    expect(document.querySelector(".sidebar")?.className).toContain("docked open");
  });
  expect(document.querySelector(".sidebar")).not.toHaveAttribute("inert");
  expect(screen.queryByRole("button", { name: /close sessions sidebar/i })).not.toBeInTheDocument();
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "stale",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "stale_sample",
          gpu: {
            usedMb: 8192,
            totalMb: 16384,
            utilizationPct: 50
          }
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

    if (url.endsWith("/api/models/warm")) {
      requests.push({ url, body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z",
          loadDuration: 125_000_000,
          totalDuration: 130_000_000
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1/model-switch")) {
      requests.push({ url, body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:04:00.000Z",
            messages: [
              {
                id: "switch_sess_1_2026-04-20T18:04:00.000Z",
                role: "system",
                content: "",
                createdAt: "2026-04-20T18:04:00.000Z",
                kind: "model_switch",
                model: "llama3.1:8b"
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

  fireEvent.click((await screen.findAllByRole("button", { name: /expand settings sidebar/i }))[0]!);
  fireEvent.click(screen.getByText("App defaults"));
  expect(await screen.findByDisplayValue("Use markdown.")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "System prompt" }), {
    target: { value: "Use bullets." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

  await waitFor(() => {
    expect(requests.some((request) => request.url.endsWith("/api/settings/defaults"))).toBe(true);
  });

  fireEvent.click(screen.getAllByRole("button", { name: /models/i })[0]!);
  fireEvent.click(screen.getByRole("option", { name: /llama3.1:8b/i }));
  fireEvent.click(screen.getByText("Session overrides"));
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

test("clears optional defaults and session overrides instead of preserving stale values", async () => {
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

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Existing chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
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
              title: "Existing chat",
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

      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Existing chat",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages: [],
            overrides: {
              seed: 7,
              keep_alive: "30m"
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
          dependencies: { chatService: "ok", modelService: "ok", sessionService: "ok", metricsService: "ok" }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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
            ...defaultAppDefaults,
            options: {
              ...defaultAppDefaults.options,
              seed: 99,
              keep_alive: "1h"
            }
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.click((await screen.findAllByRole("button", { name: /expand settings sidebar/i }))[0]!);
  fireEvent.click(screen.getByText("App defaults"));
  fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Keep alive"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

  await waitFor(() => {
    expect(requests.some((request) => request.url.endsWith("/api/settings/defaults"))).toBe(true);
  });

  fireEvent.click(screen.getByText("Session overrides"));
  fireEvent.change(screen.getByLabelText("Seed override"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Keep alive override"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save session" }));

  await waitFor(() => {
    expect(requests.some((request) => request.url.endsWith("/api/sessions/sess_1"))).toBe(true);
  });

  const defaultsBody = requests.find((request) => request.url.endsWith("/api/settings/defaults"))?.body ?? "";
  const overridesBody = requests.find((request) => request.url.endsWith("/api/sessions/sess_1"))?.body ?? "";

  expect(defaultsBody).not.toContain('"seed"');
  expect(defaultsBody).not.toContain('"keep_alive"');
  expect(overridesBody).toContain('"overrides":{}');
});

test("keeps the app usable when sessions or health fail during bootstrap", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      throw new Error("session service offline");
    }

    if (url.endsWith("/api/health")) {
      throw new Error("gateway health unavailable");
    }

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "request_failed"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/settings/defaults")) {
      return new Response(
        JSON.stringify({
          defaults: defaultAppDefaults
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.click((await screen.findAllByRole("button", { name: /expand settings sidebar/i }))[0]!);
  fireEvent.click(await screen.findByText("System status"));

  await waitFor(() => {
    expect(screen.getAllByText("Gateway degraded").length).toBeGreaterThan(0);
  });

  expect(screen.getByPlaceholderText("Send a message to the model...")).not.toBeDisabled();
  expect(screen.getByText("Start a new conversation when you’re ready.")).toBeInTheDocument();
});

test("creates a new session from the active model", async () => {
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
      if (init?.method === "POST") {
        requests.push({ url, body: String(init.body ?? "") });
        return new Response(
          JSON.stringify({
            session: {
              id: "sess_2",
              title: "New chat",
              model: "llama3.1:8b",
              createdAt: "2026-04-20T18:04:00.000Z",
              updatedAt: "2026-04-20T18:04:00.000Z",
              messages: [],
              overrides: {}
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Existing chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "qwen2.5-coder:7b",
          warmedAt: "2026-04-20T18:04:00Z",
          loadDuration: 125_000_000,
          totalDuration: 130_000_000
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

    if (url.endsWith("/api/sessions/sess_1") || url.endsWith("/api/sessions/sess_2")) {
      return new Response(
        JSON.stringify({
          session: {
            id: url.endsWith("sess_2") ? "sess_2" : "sess_1",
            title: url.endsWith("sess_2") ? "New chat" : "Existing chat",
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

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.click((await screen.findAllByRole("button", { name: /expand sessions sidebar/i }))[0]!);
  await screen.findByRole("button", { name: /existing chat/i });
  fireEvent.click(screen.getByRole("button", { name: "New session" }));

  await waitFor(() => {
    expect(requests.some((request) => request.url.endsWith("/api/sessions"))).toBe(true);
  });

  expect(requests[0]?.body).toContain('"model":"llama3.1:8b"');
  expect(screen.getByText("New session ready")).toBeInTheDocument();
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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
  expect(screen.getByText("Start a new conversation when you’re ready.")).toBeInTheDocument();
  expect(screen.getByText("History cleared")).toBeInTheDocument();
});

test("streams thinking and markdown response into the UI as chunks arrive", async () => {
  const encoder = new TextEncoder();
  let streamController: { enqueue(chunk: Uint8Array): void; close(): void } | null = null;
  let sessionDetailLoads = 0;

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
      sessionDetailLoads += 1;

      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: sessionDetailLoads > 1 ? "Fix greeting format" : "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages:
              sessionDetailLoads > 1
                ? [
                    {
                      id: "msg_user_1",
                      role: "user",
                      content: "Hello",
                      createdAt: "2026-04-20T18:03:01.000Z"
                    },
                    {
                      id: "msg_assistant_1",
                      role: "assistant",
                      content: "# Hello there\n\n- First point",
                      createdAt: "2026-04-20T18:03:02.000Z",
                      thinking: {
                        content: "Thinking...",
                        collapsedByDefault: true
                      }
                    }
                  ]
                : [],
            overrides: {}
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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

  fireEvent.click((await screen.findAllByRole("button", { name: /expand sessions sidebar/i }))[0]!);
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
  controller.enqueue(encoder.encode('event: session_title\ndata: {"sessionId":"sess_1","title":"Fix greeting format"}\n\n'));

  await waitFor(() => {
    expect(screen.getByText("Streaming reasoning...")).toBeInTheDocument();
    expect(container.querySelector(".thinking-box")).toHaveTextContent("Thinking...");
  });
  expect(screen.getByRole("button", { name: /fix greeting format/i })).toBeInTheDocument();

  expect(screen.queryByText("Hello there")).not.toBeInTheDocument();

  controller.enqueue(encoder.encode('event: response_delta\ndata: {"text":"# Hello there\\n\\n- First point"}\n\n'));
  controller.enqueue(encoder.encode('event: done\ndata: {"finishReason":"stop"}\n\n'));
  controller.close();

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Hello there" })).toBeInTheDocument();
  });
  expect(screen.getByText("First point")).toBeInTheDocument();
  expect(screen.getByText("Complete")).toBeInTheDocument();
  await screen.findByRole("button", { name: /fix greeting format/i });
});

test("prevents overlapping chat submissions while a stream is already active", async () => {
  const encoder = new TextEncoder();
  let streamController: { enqueue(chunk: Uint8Array): void; close(): void } | null = null;
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
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

  const promptBox = await screen.findByPlaceholderText("Send a message to the model...");
  fireEvent.change(promptBox, {
    target: { value: "First prompt" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  await waitFor(() => {
    expect(chatRequests).toHaveLength(1);
  });
  expect(promptBox).toBeDisabled();

  fireEvent.change(promptBox, {
    target: { value: "Second prompt" }
  });
  fireEvent.keyDown(promptBox, { key: "Enter", code: "Enter" });

  expect(chatRequests).toHaveLength(1);

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const controller = streamController as { enqueue(chunk: Uint8Array): void; close(): void };
  controller.enqueue(encoder.encode('event: done\ndata: {"finishReason":"stop"}\n\n'));
  controller.close();

  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: /prompt/i })).not.toBeDisabled();
  });
});

test("surfaces non-200 chat stream responses as visible failures", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          ready: true,
          model: "llama3.1:8b",
          warmedAt: "2026-04-20T18:04:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
      return new Response(
        JSON.stringify({
          message: "Upstream stream failed before it could start."
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.change(await screen.findByPlaceholderText("Send a message to the model..."), {
    target: { value: "Hello" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  await waitFor(() => {
    expect(screen.getByText("Request failed")).toBeInTheDocument();
  });
  expect(screen.getAllByText(/Upstream stream failed before it could start\./i)).toHaveLength(2);
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          model: "qwen2.5-coder:7b",
          ready: true,
          warmedAt: "2026-04-20T18:02:31Z",
          loadDuration: 120_000_000
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
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
    expect(screen.getByRole("option", { name: /gemma4:12b/i })).toHaveAttribute("aria-selected", "true");
  });

  fireEvent.click(screen.getAllByRole("button", { name: /models/i })[0]!);
  fireEvent.click(screen.getByRole("option", { name: /qwen2.5-coder:7b/i }));

  await waitFor(() => {
    expect(screen.getByText("qwen2.5-coder:7b ready")).toBeInTheDocument();
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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
  let sessionDetailLoads = 0;

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
      sessionDetailLoads += 1;

      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Troubleshooting nginx config",
            model: "llama3.1:8b",
            createdAt: "2026-04-20T18:00:00.000Z",
            updatedAt: "2026-04-20T18:03:00.000Z",
            messages:
              sessionDetailLoads > 1
                ? [
                    {
                      id: "msg_user_1",
                      role: "user",
                      content: "Hello",
                      createdAt: "2026-04-20T18:03:01.000Z"
                    },
                    {
                      id: "msg_assistant_1",
                      role: "assistant",
                      content: "Recovered answer",
                      createdAt: "2026-04-20T18:03:02.000Z"
                    }
                  ]
                : [],
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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

  fireEvent.click((await screen.findAllByRole("button", { name: /expand sessions sidebar/i }))[0]!);
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

test("shows queued status updates and a delayed keep-waiting prompt", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 },
            { name: "qwen2.5-coder:7b", modifiedAt: "2026-04-20T18:01:00Z", size: 456 }
          ],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/runtime/ollama")) {
      return new Response(
        JSON.stringify({
          busy: true,
          activeRequests: 1,
          maxParallelRequests: 1,
          queueDepth: 1,
          residentModels: ["llama3.1:8b"],
          fastPathModels: ["llama3.1:8b"],
          fetchedAt: "2026-04-20T18:02:30.000Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          status: "already_resident",
          model: "llama3.1:8b",
          ready: true
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Queued chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Queued chat",
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
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

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.change(await screen.findByPlaceholderText("Send a message to the model..."), {
    target: { value: "Queue me" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const encoder = new TextEncoder();
  const controller = streamController as unknown as { enqueue(chunk: Uint8Array): void };
  controller.enqueue(
    encoder.encode('event: queued\ndata: {"requestId":"req_queued","position":2,"queueDepth":2,"model":"llama3.1:8b","promptAfterMs":12000}\n\n')
  );

  await waitFor(() => {
    expect(screen.getAllByText(/Queued at position 2 of 2/i).length).toBeGreaterThan(0);
  });
  expect(screen.queryByRole("button", { name: /keep waiting/i })).not.toBeInTheDocument();

  setTimeout(() => {
    controller.enqueue(encoder.encode('event: queue_prompt\ndata: {"requestId":"req_queued","position":2,"waitedMs":12034}\n\n'));
  }, 25);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /keep waiting/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /leave queue/i }).length).toBeGreaterThan(0);
  });
});

test("retargets a queued request when the user switches models", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const patchBodies: string[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 },
            { name: "qwen2.5-coder:7b", modifiedAt: "2026-04-20T18:01:00Z", size: 456 }
          ],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/runtime/ollama")) {
      return new Response(
        JSON.stringify({
          busy: true,
          activeRequests: 1,
          maxParallelRequests: 1,
          queueDepth: 1,
          residentModels: ["llama3.1:8b"],
          fastPathModels: ["llama3.1:8b"],
          fetchedAt: "2026-04-20T18:02:30.000Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          status: "already_resident",
          model: "llama3.1:8b",
          ready: true
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Queued chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Queued chat",
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
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

    if (url.includes("/api/chat/requests/req_queued")) {
      patchBodies.push(String(init?.body ?? ""));

      return new Response(
        JSON.stringify({
          request: {
            requestId: "req_queued",
            state: "queued",
            model: "qwen2.5-coder:7b",
            position: 1,
            queueDepth: 1,
            queuedAt: "2026-04-20T18:05:00.000Z"
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.change(await screen.findByPlaceholderText("Send a message to the model..."), {
    target: { value: "Queue and switch" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const controller = streamController as unknown as { enqueue(chunk: Uint8Array): void };
  controller.enqueue(
    new TextEncoder().encode(
      'event: queued\ndata: {"requestId":"req_queued","position":2,"queueDepth":2,"model":"llama3.1:8b","promptAfterMs":12000}\n\n'
    )
  );

  await waitFor(() => {
    expect(screen.getAllByText(/Queued at position 2 of 2/i).length).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getAllByRole("button", { name: /models/i })[0]!);
  fireEvent.click(screen.getByRole("option", { name: /qwen2.5-coder:7b/i }));

  await waitFor(() => {
    expect(patchBodies).toHaveLength(1);
  });
  expect(patchBodies[0]).toContain('"model":"qwen2.5-coder:7b"');
  expect(screen.getByText("Queued request updated to qwen2.5-coder:7b.")).toBeInTheDocument();
});

test("cancels a queued request from the delayed queue prompt", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
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

    if (url.endsWith("/api/runtime/ollama")) {
      return new Response(
        JSON.stringify({
          busy: true,
          activeRequests: 1,
          maxParallelRequests: 1,
          queueDepth: 1,
          residentModels: ["llama3.1:8b"],
          fastPathModels: ["llama3.1:8b"],
          fetchedAt: "2026-04-20T18:02:30.000Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          status: "already_resident",
          model: "llama3.1:8b",
          ready: true
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Queued chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Queued chat",
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/chat/stream")) {
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
      stopRequested = true;
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
    target: { value: "Queue then cancel" }
  });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);

  if (!streamController) {
    throw new Error("stream controller was not initialized");
  }

  const encoder = new TextEncoder();
  const controller = streamController as unknown as { enqueue(chunk: Uint8Array): void };
  controller.enqueue(
    encoder.encode('event: queued\ndata: {"requestId":"req_queued","position":1,"queueDepth":1,"model":"llama3.1:8b","promptAfterMs":12000}\n\n')
  );

  const queuePromptTimer = setTimeout(() => {
    try {
      controller.enqueue(
        encoder.encode('event: queue_prompt\ndata: {"requestId":"req_queued","position":1,"waitedMs":12034}\n\n')
      );
    } catch {
      // The client may have already cancelled and closed the stream.
    }
  }, 25);

  try {
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /leave queue/i }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /leave queue/i })[0]!);

    await waitFor(() => {
      expect(stopRequested).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText("Queued request cancelled.")).toBeInTheDocument();
    });
  } finally {
    clearTimeout(queuePromptTimer);
  }
});

test("highlights fast-path models and stays usable when runtime data is unavailable", async () => {
  const runtimeRequests: string[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);

    if (url.endsWith("/api/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: "llama3.1:8b", modifiedAt: "2026-04-20T18:00:00Z", size: 123 },
            { name: "qwen2.5-coder:7b", modifiedAt: "2026-04-20T18:01:00Z", size: 456 }
          ],
          fetchedAt: "2026-04-20T18:02:00Z"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/runtime/ollama")) {
      runtimeRequests.push(url);

      if (runtimeRequests.length === 1) {
        return new Response(
          JSON.stringify({
            busy: false,
            activeRequests: 0,
            maxParallelRequests: 1,
            queueDepth: 0,
            residentModels: ["llama3.1:8b"],
            fastPathModels: ["llama3.1:8b"],
            fetchedAt: "2026-04-20T18:02:30.000Z"
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      throw new Error("runtime unavailable");
    }

    if (url.endsWith("/api/models/warm")) {
      return new Response(
        JSON.stringify({
          status: "already_resident",
          model: "llama3.1:8b",
          ready: true
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions")) {
      return new Response(
        JSON.stringify({
          sessions: [{ id: "sess_1", title: "Runtime chat", model: "llama3.1:8b", updatedAt: "2026-04-20T18:03:00Z" }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/api/sessions/sess_1")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "sess_1",
            title: "Runtime chat",
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

    if (url.endsWith("/api/metrics/gpu")) {
      return new Response(
        JSON.stringify({
          status: "unavailable",
          sampledAt: "2026-04-20T18:02:30Z",
          reason: "not_configured"
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unhandled fetch for ${url}`);
  });

  render(<App />);

  fireEvent.click((await screen.findAllByRole("button", { name: /models/i }))[0]!);

  await waitFor(() => {
    expect(screen.getByText("Fast path")).toBeInTheDocument();
  });
  expect(screen.getByRole("option", { name: /llama3.1:8b/i })).toBeInTheDocument();
  expect(screen.getAllByText(/Fast path: llama3.1:8b/i).length).toBeGreaterThan(0);

  fireEvent.pointerDown(document.body);
  fireEvent.click(screen.getAllByRole("button", { name: /models/i })[0]!);
  fireEvent.click(screen.getByRole("button", { name: /refresh models/i }));

  await waitFor(() => {
    expect(screen.getAllByText("Runtime data unavailable").length).toBeGreaterThan(0);
  });
});
