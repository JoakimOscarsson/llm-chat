export type HostGpuMetrics = {
  sampledAt: string;
  gpu: {
    index: number;
    name: string;
    usedMb: number;
    totalMb: number;
    utilizationPct: number;
    temperatureC?: number;
    powerDrawW?: number;
    powerLimitW?: number;
  };
};

export type HostGpuErrorResponse = {
  status: "unavailable";
  sampledAt: string;
  reason: string;
};
