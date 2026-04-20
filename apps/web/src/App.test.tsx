import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders discovered models from the gateway", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
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
    )
  );

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: /model selector/i })).toHaveValue("llama3.1:8b");
  });

  expect(screen.getByRole("option", { name: "llama3.1:8b" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "qwen2.5:7b" })).toBeInTheDocument();
});
