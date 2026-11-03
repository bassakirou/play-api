const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env.local'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local database required');
  const config = await db.monetizationConfig.findUnique({ where: { id: 'default' } });
  console.log({ apiKeyPresent: Boolean(config?.taraApiKey), businessIdPresent: Boolean(config?.taraBusinessId), baseUrl: config?.taraBaseUrl, webhookUrl: config?.taraWebhookUrl, localWebhookOverride: process.env.TARA_LOCAL_WEBHOOK_URL || null });
  console.log(await db.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, productId: true, status: true, vendor: true, createdAt: true } }));
  const transaction = await db.transaction.findFirst({ orderBy: { createdAt: 'desc' } });
  if (transaction?.userId) {
    const token = require('jsonwebtoken').sign({ sub: transaction.userId }, process.env.JWT_SECRET || 'secretKey', { expiresIn: '5m' });
    for (const route of ['/stats/creator', `/monetization/transaction/${transaction.id}/status`]) {
      const res = await fetch(`http://localhost:3022${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
      const data = await res.json();
      console.log({ route, httpStatus: res.status, status: data.status, verificationError: data.verificationError, ownContentCounts: data.songs ? [data.songs.length, data.videos.length, data.books.length] : undefined });
    }
  }
  if (transaction && config?.taraApiKey) {
    const list = await fetch('https://www.dklo.co/api/tara/transactionlist', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.taraApiKey}` }, body: JSON.stringify({ apiKey: config.taraApiKey, businessId: config.taraBusinessId, start: 0, size: 1 }), signal: AbortSignal.timeout(20000) });
    const listing = await list.json();
    console.log({ credentialCheckHttp: list.status, providerStatus: listing.status, providerMessage: listing.message, resultIsArray: Array.isArray(listing), fields: Object.keys(listing).filter(k => !/^\d+$/.test(k)) });
    try {
      const start = Date.now();
      const res = await fetch('https://www.dklo.co/api/tara/transactions/status', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.taraApiKey}` }, body: JSON.stringify({ apiKey: config.taraApiKey, businessId: config.taraBusinessId, productId: transaction.productId }), signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      console.log({ lookupHttpStatus: res.status, elapsedMs: Date.now() - start, status: data.status, message: data.message, fields: Object.keys(data) });
    } catch(e) { console.log({ lookupError: e.name, reason: e.cause?.code }); }
  }
})().catch(e => console.error(e.message)).finally(() => db.$disconnect());
