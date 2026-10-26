import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { parse, resolve } from 'node:path';

type CpuSample = { idle: number; total: number };
type NetworkSample = { rx: number; tx: number };

export function parseMemAvailable(text: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(text);
  const bytes = match ? Number(match[1]) * 1024 : NaN;
  return Number.isFinite(bytes) ? bytes : null;
}

export function parseNetworkCounters(
  text: string,
  selected?: string,
): NetworkSample | null {
  let found = false;
  const sample = { rx: 0, tx: 0 };
  for (const line of text.split('\n')) {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1].trim();
    if (
      selected
        ? name !== selected
        : /^(lo$|docker|veth|br-|virbr|cni|flannel|tun|tap)/.test(name)
    )
      continue;
    const fields = match[2].trim().split(/\s+/);
    const rx = Number(fields[0]);
    const tx = Number(fields[8]);
    if (!Number.isFinite(rx) || !Number.isFinite(tx) || rx < 0 || tx < 0)
      return null;
    found = true;
    sample.rx += rx;
    sample.tx += tx;
  }
  return found ? sample : null;
}

export function cpuPercent(
  previous: CpuSample | null,
  current: CpuSample,
): number | null {
  if (!previous) return null;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  return total > 0 && idle >= 0 && idle <= total
    ? 100 * (1 - idle / total)
    : null;
}

export function networkRates(
  previous: NetworkSample | null,
  current: NetworkSample | null,
  elapsedSeconds: number,
) {
  if (
    !previous ||
    !current ||
    elapsedSeconds <= 0 ||
    current.rx < previous.rx ||
    current.tx < previous.tx
  )
    return { rx: null, tx: null };
  return {
    rx: (current.rx - previous.rx) / elapsedSeconds,
    tx: (current.tx - previous.tx) / elapsedSeconds,
  };
}

@Injectable()
export class HostMetricsService {
  private previousCpu: CpuSample | null = null;
  private previousNetwork: NetworkSample | null = null;
  private previousTime: number | null = null;
  constructor(private readonly config: ConfigService) {}

  get hostId(): string {
    return this.config.get<string>('MONITOR_HOST_ID')?.trim() || os.hostname();
  }

  async collect() {
    const now = performance.now();
    const cpus = os.cpus();
    const currentCpu = cpus.reduce(
      (sample, cpu) => ({
        idle: sample.idle + cpu.times.idle,
        total:
          sample.total +
          Object.values(cpu.times).reduce((total, value) => total + value, 0),
      }),
      { idle: 0, total: 0 },
    );
    const cpu = cpuPercent(this.previousCpu, currentCpu);
    this.previousCpu = currentCpu;
    let availableMemory = os.freemem();
    let network: NetworkSample | null = null;
    if (os.platform() === 'linux') {
      try {
        availableMemory =
          parseMemAvailable(await readFile('/proc/meminfo', 'utf8')) ??
          availableMemory;
      } catch {
        /* OS fallback remains measurable. */
      }
      try {
        network = parseNetworkCounters(
          await readFile('/proc/net/dev', 'utf8'),
          this.config.get<string>('MONITOR_NETWORK_INTERFACE')?.trim() ||
            undefined,
        );
      } catch {
        /* Unknown network sample. */
      }
    }
    const rates = networkRates(
      this.previousNetwork,
      network,
      this.previousTime === null ? 0 : (now - this.previousTime) / 1000,
    );
    this.previousNetwork = network;
    this.previousTime = now;
    const minioPath = this.config
      .get<string>('MONITOR_MINIO_DATA_PATH')
      ?.trim();
    const paths = [
      ...new Set([
        parse(resolve(process.cwd())).root,
        ...(minioPath ? [resolve(minioPath)] : []),
      ]),
    ];
    const disks: {
      path: string;
      totalBytes: number;
      availableBytes: number;
      usedPercent: number;
    }[] = [];
    for (const path of paths) {
      try {
        const stats = await statfs(path);
        const totalBytes = stats.blocks * stats.bsize;
        const availableBytes = stats.bavail * stats.bsize;
        if (
          Number.isFinite(totalBytes) &&
          totalBytes > 0 &&
          Number.isFinite(availableBytes) &&
          availableBytes >= 0 &&
          availableBytes <= totalBytes
        )
          disks.push({
            path,
            totalBytes,
            availableBytes,
            usedPercent: 100 * (1 - availableBytes / totalBytes),
          });
      } catch {
        /* Omit inaccessible volumes. */
      }
    }
    const capacity = Number(
      this.config.get<string>('MONITOR_NETWORK_CAPACITY_MBPS'),
    );
    const totalMemory = os.totalmem();
    return {
      hostId: this.hostId,
      cpuPercent: cpu,
      memoryPercent:
        totalMemory > 0 &&
        availableMemory >= 0 &&
        availableMemory <= totalMemory
          ? 100 * (1 - availableMemory / totalMemory)
          : null,
      nodeRssBytes: process.memoryUsage().rss,
      disks,
      diskPercent: disks.length
        ? Math.max(...disks.map((disk) => disk.usedPercent))
        : null,
      networkRxBps: rates.rx,
      networkTxBps: rates.tx,
      networkCapacityMbps:
        Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    };
  }
}
