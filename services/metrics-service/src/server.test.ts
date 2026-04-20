import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/metrics/gpu returns unavailable when no metrics backend is configured", async () => {
  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "",
      metricsTimeoutMs: 1500,
      metricsStaleAfterMs: 30_000
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/metrics/gpu"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "unavailable");
  assert.equal(response.json().reason, "not_configured");
});

test("GET /internal/metrics/gpu marks old samples as stale", async () => {
  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "http://metrics.example",
      metricsTimeoutMs: 1500,
      metricsStaleAfterMs: 30_000
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          sampledAt: "2026-04-20T17:00:00.000Z",
          gpu: {
            usedMb: 1000,
            totalMb: 16000,
            utilizationPct: 6.25
          }
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      ),
    now: () => new Date("2026-04-20T18:00:00.000Z")
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/metrics/gpu"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "stale");
  assert.equal(response.json().gpu.totalMb, 16000);
});

test("GET /internal/metrics/gpu normalizes healthy metrics samples", async () => {
  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "http://metrics.example",
      metricsTimeoutMs: 1500,
      metricsStaleAfterMs: 30_000
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          sampledAt: "2026-04-20T18:00:00.000Z",
          usedMb: 11234,
          totalMb: 16384
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      ),
    now: () => new Date("2026-04-20T18:00:10.000Z")
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/metrics/gpu"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ok");
  assert.equal(response.json().gpu.usedMb, 11234);
});
