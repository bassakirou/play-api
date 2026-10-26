import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const QUERY = `query Usage($accountTag: string!, $start: Date, $end: Date) {
 viewer { accounts(filter: {accountTag: $accountTag}) {
  totals: streamMinutesViewedAdaptiveGroups(limit: 1, filter: {date_geq: $start, date_lt: $end}) { sum { minutesViewed } }
  daily: streamMinutesViewedAdaptiveGroups(limit: 31, filter: {date_geq: $start, date_lt: $end}, orderBy: [date_ASC]) { dimensions { date } sum { minutesViewed } }
  countries: streamMinutesViewedAdaptiveGroups(limit: 250, filter: {date_geq: $start, date_lt: $end}, orderBy: [sum_minutesViewed_DESC]) { dimensions { clientCountryName } sum { minutesViewed } }
 } }
}`;
const validNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

@Injectable()
export class CloudflareUsageService implements OnModuleInit {
  private running = false;
  private lastAttempt = 0;
  private lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    void this.sync();
  }

  private credentials() {
    return {
      account: this.config.get<string>('CLOUDFLARE_ACCOUNT_ID')?.trim(),
      analytics: (
        this.config.get<string>('CLOUDFLARE_STREAM_ANALYTICS_TOKEN') ||
        this.config.get<string>('CLOUDFLARE_STREAM_API_TOKEN')
      )?.trim(),
      stream: this.config.get<string>('CLOUDFLARE_STREAM_API_TOKEN')?.trim(),
    };
  }

  private async request(
    url: string,
    token: string,
    body?: unknown,
  ): Promise<any> {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Cloudflare request failed');
    return response.json();
  }

  @Interval(900_000)
  async sync(): Promise<void> {
    const credentials = this.credentials();
    if (
      !credentials.account ||
      !credentials.analytics ||
      this.running ||
      Date.now() - this.lastAttempt < 900_000
    )
      return;
    this.running = true;
    this.lastAttempt = Date.now();
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    )
      .toISOString()
      .slice(0, 10);
    try {
      const result = await this.request(
        'https://api.cloudflare.com/client/v4/graphql',
        credentials.analytics,
        {
          query: QUERY,
          variables: {
            accountTag: credentials.account,
            start: `${month}-01`,
            end,
          },
        },
      );
      const accounts = result?.data?.viewer?.accounts;
      if (
        (result?.errors != null &&
          (!Array.isArray(result.errors) || result.errors.length > 0)) ||
        !Array.isArray(accounts) ||
        accounts.length !== 1
      )
        throw new Error('Invalid analytics');
      const account = accounts[0];
      // A successful query for a new account has no aggregation rows at all.
      // Only this consistent empty response means zero; errors and partial data remain unknown.
      const emptyUsage =
        Array.isArray(account?.totals) &&
        account.totals.length === 0 &&
        Array.isArray(account.daily) &&
        account.daily.length === 0 &&
        Array.isArray(account.countries) &&
        account.countries.length === 0;
      if (
        !Array.isArray(account?.totals) ||
        (!emptyUsage &&
          (account.totals.length !== 1 ||
            !validNumber(account.totals[0]?.sum?.minutesViewed))) ||
        !Array.isArray(account.daily) ||
        !Array.isArray(account.countries)
      )
        throw new Error('Invalid analytics');
      const dates = new Set<string>();
      const codes = new Set<string>();
      const daily = account.daily.map((row: any) => {
        const date = row?.dimensions?.date;
        if (
          typeof date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !date.startsWith(`${month}-`) ||
          date >= end ||
          Number.isNaN(Date.parse(date)) ||
          dates.has(date) ||
          !validNumber(row?.sum?.minutesViewed)
        )
          throw new Error('Invalid analytics');
        dates.add(date);
        return { date, minutes: row.sum.minutesViewed };
      });
      const countries = account.countries.map((row: any) => {
        const code = row?.dimensions?.clientCountryName;
        if (
          typeof code !== 'string' ||
          !/^[A-Z]{2}$/.test(code) ||
          codes.has(code) ||
          !validNumber(row?.sum?.minutesViewed)
        )
          throw new Error('Invalid analytics');
        codes.add(code);
        return { code, minutes: row.sum.minutesViewed };
      });
      const minutesDelivered = emptyUsage
        ? 0
        : account.totals[0].sum.minutesViewed;
      if (minutesDelivered > 0 && (!daily.length || !countries.length))
        throw new Error('Incomplete analytics');
      let storedMinutes: number | null = null;
      let capacityMinutes: number | null = null;
      let storageError = false;
      if (credentials.stream) {
        try {
          const storage = await this.request(
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.account)}/stream/storage-usage`,
            credentials.stream,
          );
          if (
            storage?.success !== true ||
            !validNumber(storage?.result?.totalStorageMinutes) ||
            !validNumber(storage?.result?.totalStorageMinutesLimit)
          )
            throw new Error('Invalid storage');
          storedMinutes = storage.result.totalStorageMinutes;
          capacityMinutes = storage.result.totalStorageMinutesLimit;
        } catch {
          storageError = true;
        }
      } else {
        storageError = true;
      }
      const data = {
        fetchedAt: new Date(),
        minutesDelivered,
        storedMinutes,
        capacityMinutes,
        daily,
        countries,
      };
      await this.prisma.cloudflareUsageSnapshot.upsert({
        where: { id: month },
        create: { id: month, ...data },
        update: data,
      });
      this.lastError = storageError
        ? 'Cloudflare storage usage unavailable.'
        : null;
    } catch {
      this.lastError = 'Cloudflare usage synchronization failed.';
    } finally {
      this.running = false;
    }
  }

  private positiveSetting(key: string, fallback: number | null): number | null {
    const raw = this.config.get<string>(key);
    const value = raw == null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  async overview() {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const credentials = this.credentials();
    const configured = Boolean(credentials.account && credentials.analytics);
    const snapshot = configured
      ? await this.prisma.cloudflareUsageSnapshot.findUnique({
          where: { id: month },
        })
      : null;
    const deliveryMinutes = snapshot?.minutesDelivered ?? null;
    const storageCapacityMinutes = snapshot?.capacityMinutes ?? null;
    const deliveryUsd =
      deliveryMinutes === null
        ? null
        : (deliveryMinutes *
            this.positiveSetting('MONITOR_STREAM_DELIVERY_USD_PER_1000', 1)!) /
          1000;
    const storageCapacityUsd =
      storageCapacityMinutes === null
        ? null
        : Math.ceil(storageCapacityMinutes / 1000) *
          this.positiveSetting('MONITOR_STREAM_STORAGE_USD_PER_1000', 5)!;
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    // Project from the observation timestamp, so a stale snapshot cannot imply falling spend.
    const elapsed = snapshot ? snapshot.fetchedAt.getTime() - start : 0;
    const projectedDeliveryUsd =
      deliveryUsd !== null && elapsed >= 86_400_000
        ? (deliveryUsd * (end - start)) / elapsed
        : null;
    return {
      state: !configured
        ? 'unconfigured'
        : !snapshot
          ? 'error'
          : now.getTime() - snapshot.fetchedAt.getTime() > 1_800_000
            ? 'stale'
            : 'ready',
      month,
      fetchedAt: snapshot?.fetchedAt.toISOString() ?? null,
      deliveryMinutes,
      storageUsedMinutes: snapshot?.storedMinutes ?? null,
      storageCapacityMinutes,
      deliveryUsd,
      storageCapacityUsd,
      totalUsd:
        deliveryUsd !== null && storageCapacityUsd !== null
          ? deliveryUsd + storageCapacityUsd
          : null,
      projectedDeliveryUsd,
      projectedTotalUsd:
        projectedDeliveryUsd !== null && storageCapacityUsd !== null
          ? projectedDeliveryUsd + storageCapacityUsd
          : null,
      budgetUsd: this.positiveSetting('MONITOR_MONTHLY_BUDGET_USD', null),
      countries: (snapshot?.countries ?? []) as {
        code: string;
        minutes: number;
      }[],
      daily: (snapshot?.daily ?? []) as { date: string; minutes: number }[],
      error: configured
        ? (this.lastError ??
          (!snapshot ? 'Cloudflare usage unavailable.' : null))
        : null,
      estimated: true as const,
    };
  }
}
