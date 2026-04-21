import assert from "node:assert/strict";
import test from "node:test";
import {
  HostMetricsCollectorError,
  collectGpuMetrics,
  createNvidiaSmiCommand,
  parseNvidiaSmiCsv
} from "./nvidia-smi.js";

test("createNvidiaSmiCommand requests the expected fields", () => {
  assert.deepEqual(createNvidiaSmiCommand(), {
    command: "nvidia-smi",
    args: [
      "--query-gpu=index,name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit",
      "--format=csv,noheader,nounits"
    ]
  });
});

test("parseNvidiaSmiCsv parses a valid row and keeps optional telemetry", () => {
  const result = parseNvidiaSmiCsv(
    '0, NVIDIA GeForce RTX 4080 SUPER, 11234, 16384, 68, 61, 246.5, 320\n',
    0
  );

  assert.equal(result.gpu.index, 0);
  assert.equal(result.gpu.name, "NVIDIA GeForce RTX 4080 SUPER");
  assert.equal(result.gpu.usedMb, 11234);
  assert.equal(result.gpu.totalMb, 16384);
  assert.equal(result.gpu.utilizationPct, 68);
  assert.equal(result.gpu.temperatureC, 61);
  assert.equal(result.gpu.powerDrawW, 246.5);
  assert.equal(result.gpu.powerLimitW, 320);
});

test("parseNvidiaSmiCsv treats N/A fields as missing optional values", () => {
  const result = parseNvidiaSmiCsv('0, NVIDIA RTX, 1024, 16384, 5, N/A, N/A, 320\n', 0);

  assert.equal(result.gpu.temperatureC, undefined);
  assert.equal(result.gpu.powerDrawW, undefined);
  assert.equal(result.gpu.powerLimitW, 320);
});

test("parseNvidiaSmiCsv rejects an unknown GPU index", () => {
  assert.throws(
    () => parseNvidiaSmiCsv('0, NVIDIA RTX, 1024, 16384, 5, 41, 100, 320\n', 1),
    (error: unknown) =>
      error instanceof HostMetricsCollectorError && error.reason === "gpu_not_found"
  );
});

test("collectGpuMetrics maps command timeout into a stable collector error", async () => {
  await assert.rejects(
    () =>
      collectGpuMetrics({
        gpuIndex: 0,
        timeoutMs: 1_000,
        execFileImpl: async () => {
          throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
        }
      }),
    (error: unknown) =>
      error instanceof HostMetricsCollectorError && error.reason === "timeout"
  );
});

test("collectGpuMetrics maps missing nvidia-smi into unavailable", async () => {
  await assert.rejects(
    () =>
      collectGpuMetrics({
        gpuIndex: 0,
        timeoutMs: 1_000,
        execFileImpl: async () => {
          throw Object.assign(new Error("spawn nvidia-smi ENOENT"), { code: "ENOENT" });
        }
      }),
    (error: unknown) =>
      error instanceof HostMetricsCollectorError && error.reason === "nvidia_smi_not_found"
  );
});

test("collectGpuMetrics returns normalized output from command execution", async () => {
  const sampledAt = new Date("2026-04-21T15:30:00.000Z");
  const result = await collectGpuMetrics({
    gpuIndex: 0,
    timeoutMs: 1_000,
    execFileImpl: async (command, args) => {
      assert.equal(command, "nvidia-smi");
      assert.ok(args.includes("--format=csv,noheader,nounits"));

      return {
        stdout: '0, NVIDIA GeForce RTX 4080 SUPER, 11234, 16384, 68, 61, 246.5, 320\n',
        stderr: ""
      };
    },
    now: () => sampledAt
  });

  assert.equal(result.sampledAt, sampledAt.toISOString());
  assert.equal(result.gpu.index, 0);
  assert.equal(result.gpu.name, "NVIDIA GeForce RTX 4080 SUPER");
});
