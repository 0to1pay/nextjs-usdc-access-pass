import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, db, directory, migrate, NETWORK, required, scope, TOKEN } from '../lib/merchant.mjs';
import { persist, registerTestRecipient } from '../lib/provision.mjs';

process.umask(0o077);
try {
  const client = api();
  const tenant = scope();
  const origin = process.env.ZERO_TO_ONE_PAY_ORIGIN || 'https://api.0to1pay.com';
  const url = new URL(process.env.WEBHOOK_URL || ((new URL(required('APP_ORIGIN'))).origin +
    (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/api/webhooks/0to1pay'));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Set a public HTTPS webhook URL');
  const {data:assets} = await client.call('listChainAssets',{});
  if (!assets.some(a => a.network_id === NETWORK && a.token_address.toLowerCase() === TOKEN.toLowerCase())) {
    throw new Error('This key cannot discover Base Sepolia USDC');
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  await migrate();
  let cfg;
  try { cfg = JSON.parse(await readFile(join(directory,'config.json'),'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!cfg) {
    const instance = await persist('setup.id',randomUUID());
    const binding = JSON.stringify({...tenant,origin,webhook:url.href});
    const saved = await persist('setup.binding',binding);
    if (saved !== binding) throw new Error('This setup directory was initialized for a different merchant or URL');
    const connection = await client.call('createChainConnection',{idempotencyKey:'connect:' + instance,
      body:{network_id:NETWORK,display_name:'Next.js Base Sepolia pass'}});
    if (connection.environment !== 'test' || connection.merchant_id !== tenant.merchant_id || connection.project_id !== tenant.project_id) {
      throw new Error('Test key belongs to a different merchant/project. Check MERCHANT_ID and PROJECT_ID');
    }
    const hook = await client.call('createWebhookEndpoint',{idempotencyKey:'endpoint:' + instance,
      body:{url:url.href,description:'Next.js USDC pass',event_types:['fulfillment.requested']}});
    cfg = JSON.parse(await persist('config.json',JSON.stringify({...tenant,origin,webhook:url.href,
      connection_id:connection.connection_id,endpoint_id:hook.endpoint.endpoint_id,
      key_id:hook.signing_secret.key_id,secret:hook.signing_secret.secret_base64url})));
  }
  if (cfg.project_id !== tenant.project_id || cfg.merchant_id !== tenant.merchant_id || cfg.origin !== origin || cfg.webhook !== url.href) {
    throw new Error('Stored endpoint belongs to a different project or URL');
  }
  if (process.env.AUTO_TEST_RECIPIENTS !== 'true' || process.argv.includes('--recipient')) {
    const name = process.argv.includes('--recipient') ? randomUUID() : createHash('sha256').update(cfg.connection_id).digest('hex');
    console.log('Registered single-order test receiver',await registerTestRecipient(cfg,name));
  }
  console.log('Base Sepolia merchant ready',cfg.connection_id,cfg.endpoint_id);
} finally { await db().end(); }
