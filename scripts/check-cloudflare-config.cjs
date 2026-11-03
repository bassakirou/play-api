// Read-only account check. Never prints tokens, signing keys or secrets.
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env.local'), override: true, quiet: true });
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
if (!account || !token) { console.log('Cloudflare credentials unavailable in .env.local'); process.exit(1); }
(async () => {
  for (const path of ['/storage-usage', '/webhook']) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/stream${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok || !body.success) { console.log({ path, httpStatus: response.status, success: false }); process.exitCode = 1; continue; }
    const result = body.result;
    console.log(path === '/webhook' ? { path, success: true, notificationUrl: result.notificationUrl, localSecretConfigured: Boolean(process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET) } : { path, success: true, totalStorageMinutes: result.totalStorageMinutes, totalStorageMinutesLimit: result.totalStorageMinutesLimit });
    if (path === '/webhook' && process.argv.includes('--test-webhook') && result.secret && result.notificationUrl === 'https://api.pyramidplay.cm/video-delivery/webhook') {
      const { randomUUID, createHmac } = require('node:crypto');
      const payload = JSON.stringify({ uid: `pyramidplay-validation-${randomUUID()}` });
      const time = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', result.secret).update(time + '.').update(payload).digest('hex');
      const check = await fetch(result.notificationUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'webhook-signature': `time=${time},sig1=${signature}` }, body: payload, signal: AbortSignal.timeout(15000) });
      console.log({ webhookSignatureTestHttp: check.status });
      if (!check.ok) process.exitCode = 1;
    }
  }
})().catch(error => { console.log('Cloudflare check failed:', error.name); process.exitCode = 1; });
