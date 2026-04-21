export type HostMetricsServerConfig = {
  port: number;
  gpuIndex: number;
  commandTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostMetricsServerConfig {
  return {
    port: Number(env.PORT ?? 4010),
    gpuIndex: Number(env.HOST_METRICS_GPU_INDEX ?? 0),
    commandTimeoutMs: Number(env.HOST_METRICS_CMD_TIMEOUT_MS ?? 2_000)
  };
}
