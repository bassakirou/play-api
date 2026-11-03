// Run Prisma with a temporary schema directory, never loading production .env.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true, quiet: true });
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local database required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramidplay-local-migrations-'));
fs.copyFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), path.join(temp, 'schema.prisma'));
fs.cpSync(path.resolve(__dirname, '../prisma/migrations'), path.join(temp, 'migrations'), { recursive: true });
const cli = require.resolve('prisma/build/index.js');
// Match the existing VPS workflow: no reset and no accept-data-loss flag.
const result = spawnSync(process.execPath, [cli, 'db', 'push', '--skip-generate', '--schema', path.join(temp, 'schema.prisma')], { cwd: temp, env: process.env, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
