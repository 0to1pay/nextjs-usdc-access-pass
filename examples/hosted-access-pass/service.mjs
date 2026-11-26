import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { ZeroToOnePayClient } from '@0to1pay/server-sdk';
import { createHostedPass, initializeHostedPass } from './merchant.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing ' + name);
  return value;
}

export function connectDatabase() {
  return new pg.Pool({connectionString:required('DATABASE_URL')});
}

export function configureHostedPass(pool, getVerifiedWallet) {
  const key = required('MERCHANT_API_KEY');
  if (!key.startsWith('sp_test_')) throw new Error('Use a test project key.');
  const client = new ZeroToOnePayClient({origin:'https://api.0to1pay.com', apiKey:key});
  return createHostedPass({
    pool, client,
    scope:{merchant_id:required('MERCHANT_ID'), project_id:required('PROJECT_ID'), environment:'test'},
    keyId:required('WEBHOOK_KEY_ID'), secret:Buffer.from(required('WEBHOOK_SECRET'), 'base64url'),
    linkId:required('HOSTED_LINK_ID'), productRef:required('HOSTED_PRODUCT_REF'), getVerifiedWallet,
  });
}

async function main(mode) {
  if (!['migrate','worker'].includes(mode)) throw new Error('Use migrate or worker.');
  const pool = connectDatabase();
  try {
    if (mode === 'migrate') return await initializeHostedPass(pool);
    const {worker} = configureHostedPass(pool, async () => null);
    let running = true;
    process.once('SIGTERM', () => { running = false; });
    process.once('SIGINT', () => { running = false; });
    while (running) {
      const {command, receipt} = await worker.tick();
      if (!command && !receipt && running) await delay(1000);
    }
  } finally { await pool.end(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main(process.argv[2]);
