import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostGpuMetrics } from "../types.js";

const execFileAsync = promisify(execFile);
const QUERY_FIELDS = [
  "index",
  "name",
  "memory.used",
  "memory.total",
  "utilization.gpu",
  "temperature.gpu",
  "power.draw",
  "power.limit"
];

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

export type ExecFileImpl = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; timeout: number; maxBuffer: number }
) => Promise<ExecFileResult>;

export type CollectGpuMetricsOptions = {
  gpuIndex: number;
  timeoutMs: number;
  execFileImpl?: ExecFileImpl;
  now?: () => Date;
};

export class HostMetricsCollectorError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "HostMetricsCollectorError";
    this.reason = reason;
  }
}

export function createNvidiaSmiCommand() {
  return {
    command: "nvidia-smi",
    args: [
      `--query-gpu=${QUERY_FIELDS.join(",")}`,
      "--format=csv,noheader,nounits"
    ]
  };
}

function parseOptionalNumber(rawValue: string): number | undefined {
  const normalized = rawValue.trim();

  if (!normalized || normalized === "N/A") {
    return undefined;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseRequiredNumber(rawValue: string, fieldName: string): number {
  const numeric = parseOptionalNumber(rawValue);

  if (typeof numeric !== "number") {
    throw new HostMetricsCollectorError("invalid_payload", `Missing numeric value for ${fieldName}`);
  }

  return numeric;
}

export function parseNvidiaSmiCsv(output: string, gpuIndex: number, sampledAt = new Date()): HostGpuMetrics {
  const rows = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rows.length === 0) {
    throw new HostMetricsCollectorError("no_nvidia_device", "No NVIDIA devices were reported");
  }

  for (const row of rows) {
    const columns = row.split(",").map((part) => part.trim());

    if (columns.length < 8) {
      throw new HostMetricsCollectorError("invalid_payload", "Unexpected nvidia-smi output shape");
    }

    const rowIndex = parseRequiredNumber(columns[0], "index");
    if (rowIndex !== gpuIndex) {
      continue;
    }

    const name = columns[1];
    if (!name) {
      throw new HostMetricsCollectorError("invalid_payload", "Missing GPU name");
    }

    return {
      sampledAt: sampledAt.toISOString(),
      gpu: {
        index: rowIndex,
        name,
        usedMb: parseRequiredNumber(columns[2], "memory.used"),
        totalMb: parseRequiredNumber(columns[3], "memory.total"),
        utilizationPct: parseRequiredNumber(columns[4], "utilization.gpu"),
        temperatureC: parseOptionalNumber(columns[5]),
        powerDrawW: parseOptionalNumber(columns[6]),
        powerLimitW: parseOptionalNumber(columns[7])
      }
    };
  }

  throw new HostMetricsCollectorError(
    "gpu_not_found",
    `GPU index ${gpuIndex} was not found in nvidia-smi output`
  );
}

function isTimeoutError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; killed?: boolean; signal?: string };
  return (
    candidate.code === "ETIMEDOUT" ||
    candidate.signal === "SIGTERM" ||
    candidate.killed === true ||
    candidate.message?.toLowerCase().includes("timed out") === true
  );
}

function mapCollectorError(error: unknown): HostMetricsCollectorError {
  if (error instanceof HostMetricsCollectorError) {
    return error;
  }

  const candidate = error as { code?: string; stderr?: string; message?: string };
  const stderr = candidate.stderr?.trim() ?? "";
  const message = candidate.message?.trim() ?? "Failed to collect GPU metrics";

  if (candidate.code === "ENOENT") {
    return new HostMetricsCollectorError("nvidia_smi_not_found", "nvidia-smi is not installed or not visible");
  }

  if (isTimeoutError(error)) {
    return new HostMetricsCollectorError("timeout", "Timed out while waiting for nvidia-smi");
  }

  if (/no devices were found|not found/i.test(stderr) || /no devices were found/i.test(message)) {
    return new HostMetricsCollectorError("no_nvidia_device", "No NVIDIA devices were found");
  }

  return new HostMetricsCollectorError("collector_failed", stderr || message);
}

export async function collectGpuMetrics(options: CollectGpuMetricsOptions): Promise<HostGpuMetrics> {
  const execImpl = options.execFileImpl ?? execFileAsync;
  const now = options.now ?? (() => new Date());
  const { command, args } = createNvidiaSmiCommand();

  try {
    const result = await execImpl(command, args, {
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024
    });

    return parseNvidiaSmiCsv(result.stdout, options.gpuIndex, now());
  } catch (error) {
    throw mapCollectorError(error);
  }
}
