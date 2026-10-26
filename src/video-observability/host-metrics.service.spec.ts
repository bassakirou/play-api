import {
  HostMetricsService,
  cpuPercent,
  networkRates,
  parseMemAvailable,
  parseNetworkCounters,
} from './host-metrics.service';

describe('host metric parsers and deltas', () => {
  it('uses MemAvailable in bytes and rejects missing measurements', () => {
    expect(parseMemAvailable('MemTotal: 1000 kB\nMemAvailable: 400 kB\n')).toBe(
      409600,
    );
    expect(parseMemAvailable('MemFree: 10 kB')).toBeNull();
  });
  it('aggregates real non-loopback network counters or selects an interface', () => {
    const text =
      'Inter-| Receive\n lo: 999 0 0 0 0 0 0 0 999 0\n eth0: 100 0 0 0 0 0 0 0 200 0\n eth1: 50 0 0 0 0 0 0 0 70 0';
    expect(parseNetworkCounters(text)).toEqual({ rx: 150, tx: 270 });
    expect(parseNetworkCounters(text, 'eth0')).toEqual({ rx: 100, tx: 200 });
    expect(parseNetworkCounters(text, 'absent')).toBeNull();
  });
  it('reports first and reset network samples as unknown', () => {
    expect(networkRates(null, { rx: 100, tx: 200 }, 1)).toEqual({
      rx: null,
      tx: null,
    });
    expect(networkRates({ rx: 100, tx: 200 }, { rx: 300, tx: 500 }, 2)).toEqual(
      { rx: 100, tx: 150 },
    );
    expect(networkRates({ rx: 100, tx: 200 }, { rx: 1, tx: 2 }, 2)).toEqual({
      rx: null,
      tx: null,
    });
  });
  it('derives CPU utilization from idle and total deltas', () => {
    expect(cpuPercent(null, { idle: 100, total: 200 })).toBeNull();
    expect(
      cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 }),
    ).toBe(75);
    expect(
      cpuPercent({ idle: 100, total: 200 }, { idle: 50, total: 100 }),
    ).toBeNull();
  });
  it('excludes virtual interfaces by default while allowing explicit selection', () => {
    const text = [
      'docker0',
      'veth123',
      'br-abcd',
      'virbr0',
      'cni0',
      'flannel.1',
      'tun0',
      'tap0',
      'lo',
      'eth0',
    ]
      .map((name) => `${name}: 100 0 0 0 0 0 0 0 200 0`)
      .join('\n');
    expect(parseNetworkCounters(text)).toEqual({ rx: 100, tx: 200 });
    expect(parseNetworkCounters(text, 'docker0')).toEqual({ rx: 100, tx: 200 });
  });
  it('collects local measurements with unknown first deltas and configured host capacity', async () => {
    const settings: Record<string, string> = {
      MONITOR_HOST_ID: 'local-test',
      MONITOR_NETWORK_CAPACITY_MBPS: '100',
    };
    const service = new HostMetricsService({
      get: (key: string) => settings[key],
    } as any);
    const result = await service.collect();
    expect(result).toMatchObject({
      hostId: 'local-test',
      cpuPercent: null,
      networkRxBps: null,
      networkTxBps: null,
      networkCapacityMbps: 100,
    });
    expect(result.nodeRssBytes).toBeGreaterThan(0);
    expect(result.memoryPercent).toBeGreaterThanOrEqual(0);
    expect(result.memoryPercent).toBeLessThanOrEqual(100);
    for (const disk of result.disks) {
      expect(disk.totalBytes).toBeGreaterThan(0);
      expect(disk.availableBytes).toBeGreaterThanOrEqual(0);
      expect(disk.usedPercent).toBeGreaterThanOrEqual(0);
    }
  });
});
