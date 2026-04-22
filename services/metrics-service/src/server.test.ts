import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/metrics/gpu returns unavailable when no metrics backend is configured", async () => {
  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "",
      metricsCfAccessClientId: "",
      metricsCfAccessClientSecret: "",
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
      metricsCfAccessClientId: "",
      metricsCfAccessClientSecret: "",
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
      metricsCfAccessClientId: "",
      metricsCfAccessClientSecret: "",
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

test("GET /internal/metrics/gpu preserves optional telemetry fields from the host metrics server", async () => {
  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "http://metrics.example",
      metricsCfAccessClientId: "",
      metricsCfAccessClientSecret: "",
      metricsTimeoutMs: 1500,
      metricsStaleAfterMs: 30_000
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          sampledAt: "2026-04-20T18:00:00.000Z",
          gpu: {
            index: 0,
            name: "NVIDIA GeForce RTX 4080 SUPER",
            usedMb: 11234,
            totalMb: 16384,
            utilizationPct: 68,
            temperatureC: 61,
            powerDrawW: 246.5,
            powerLimitW: 320
          }
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
  assert.equal(response.json().gpu.index, 0);
  assert.equal(response.json().gpu.name, "NVIDIA GeForce RTX 4080 SUPER");
  assert.equal(response.json().gpu.temperatureC, 61);
  assert.equal(response.json().gpu.powerDrawW, 246.5);
  assert.equal(response.json().gpu.powerLimitW, 320);
});

test("GET /internal/metrics/gpu forwards optional Cloudflare headers when configured", async () => {
  let seenHeaders: Headers | undefined;

  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "http://metrics.example",
      metricsCfAccessClientId: "metrics-client-id",
      metricsCfAccessClientSecret: "metrics-client-secret",
      metricsTimeoutMs: 1500,
      metricsStaleAfterMs: 30_000
    },
    fetchImpl: async (_input, init) => {
      seenHeaders = new Headers(init?.headers);

      return new Response(
        JSON.stringify({
          sampledAt: "2026-04-20T18:00:00.000Z",
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
      );
    },
    now: () => new Date("2026-04-20T18:00:10.000Z")
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/metrics/gpu"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenHeaders?.get("CF-Access-Client-Id"), "metrics-client-id");
  assert.equal(seenHeaders?.get("CF-Access-Client-Secret"), "metrics-client-secret");
});

test("GET /internal/metrics/gpu omits Cloudflare headers when they are not configured", async () => {
  let seenHeaders: Headers | undefined;

  const app = createApp({
    config: {
      port: 4004,
      metricsBaseUrl: "http://metrics.example",
      metricsCfAccessClientId: "",
      metricsCfAccessClientSecret: "",
      metricsTimeoutMs: 1500,
      metricsStaleAfterMs: 30_000
    },
    fetchImpl: async (_input, init) => {
      seenHeaders = new Headers(init?.headers);

      return new Response(
        JSON.stringify({
          sampledAt: "2026-04-20T18:00:00.000Z",
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
      );
    },
    now: () => new Date("2026-04-20T18:00:10.000Z")
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/metrics/gpu"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenHeaders?.has("CF-Access-Client-Id"), false);
  assert.equal(seenHeaders?.has("CF-Access-Client-Secret"), false);
});
