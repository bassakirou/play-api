/** Thresholds shared by collection, alert rules and the administration response. */
export const MONITOR_THRESHOLDS = {
  cpu: 85,
  cpuConsecutiveSamples: 3,
  memory: 90,
  disk: 85,
  diskCritical: 95,
  network: 85,
} as const;
