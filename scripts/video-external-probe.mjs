/** Run on a separate machine, with explicit environment configuration.
 * node scripts/video-external-probe.mjs --once (scheduled every minute), or omit --once.
 * Stores failed delivery locally and resends on recovery. Sends no email/message.
 */
import { createHmac } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = new URL(process.env.PROBE_TARGET_URL);
const report = new URL(process.env.PROBE_REPORT_URL);
const secret = process.env.MONITOR_EXTERNAL_PROBE_SECRET || '';
const probeId = process.env.PROBE_ID || '';
if (secret.length < 32 || !/^[a-zA-Z0-9_-]{1,64}$/.test(probeId))
  throw new Error('Set PROBE_ID and a secret of at least 32 characters.');
for (const url of [target, report])
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid probe URL.');
const spool = resolve(
  process.env.PROBE_SPOOL_PATH || './video-probe-spool.json',
);

async function tick() {
  let queue = [];
  try {
    queue = JSON.parse(await readFile(spool, 'utf8'));
    if (!Array.isArray(queue)) throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(
        'Unreadable spool; preserve and repair it before continuing.',
      );
  }
  const started = performance.now();
  let status = 'down';
  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    status = response.ok ? 'up' : 'down';
    await response.body?.cancel();
  } catch {
    /* Record timeout/network failure as a measured failed probe. */
  }
  queue.push({
    probeId,
    observedAt: new Date().toISOString(),
    status,
    latencyMs: Math.round(performance.now() - started),
  });
  queue = queue
    .filter((row) => Date.parse(row.observedAt) > Date.now() - 47 * 3_600_000)
    .slice(-2880);
  for (let i = 0; i < 60 && queue.length; i++) {
    const body = JSON.stringify(queue[0]);
    try {
      const response = await fetch(report, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Probe-Signature': createHmac('sha256', secret)
            .update(body)
            .digest('hex'),
        },
        body,
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      await response.body?.cancel();
      if (!response.ok) break;
      queue.shift();
    } catch {
      break;
    }
  }
  await writeFile(spool + '.tmp', JSON.stringify(queue), { mode: 0o600 });
  await rename(spool + '.tmp', spool);
  console.log(
    `${new Date().toISOString()} ${probeId} ${status}; ${queue.length} pending report(s)`,
  );
}

do {
  await tick();
  if (process.argv.includes('--once')) break;
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} while (true);
