import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
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
});
