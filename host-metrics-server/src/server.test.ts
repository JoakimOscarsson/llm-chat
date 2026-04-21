import assert from "node:assert/strict";
import test from "node:test";
import { HostMetricsCollectorError } from "./collector/nvidia-smi.js";
import { createApp } from "./server.js";

test("GET /health returns ok", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ok");
});

test("GET /version returns contract information", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/version" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().service, "host-metrics-server");
  assert.equal(response.json().contractVersion, "v1");
});

test("GET /gpu returns normalized host metrics", async () => {
  const app = createApp({
    collector: async () => ({
      sampledAt: "2026-04-21T15:30:00.000Z",
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
    })
  });

  const response = await app.inject({ method: "GET", url: "/gpu" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().gpu.utilizationPct, 68);
});

test("GET /gpu returns a clean unavailable error when the collector cannot see nvidia-smi", async () => {
  const app = createApp({
    collector: async () => {
      throw new HostMetricsCollectorError("nvidia_smi_not_found", "nvidia-smi not found");
    }
  });

  const response = await app.inject({ method: "GET", url: "/gpu" });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, "unavailable");
  assert.equal(response.json().reason, "nvidia_smi_not_found");
});
