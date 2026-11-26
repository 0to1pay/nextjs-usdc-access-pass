import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { canonicalJson, sha256, signWebhook } from '@0to1pay/fulfillment-sdk';
import pg from 'pg';
import { createHostedPass, initializeHostedPass } from './merchant.mjs';

const scope = { merchant_id: randomUUID(), project_id: randomUUID(), environment: 'test' };
const network = 'eip155:84532';
const productRef = 'course-pass';
const linkId = randomUUID();
const secret = randomBytes(32);
const keyId = 'test-signing-key';
const buyer = '0x' + randomBytes(20).toString('hex');
const otherBuyer = '0x' + randomBytes(20).toString('hex');

function grant(changes = {}) {
  const now = new Date().toISOString();
  const payload = { link_id: linkId, product_ref: productRef };
  const command = {
    ...scope, command_id: randomUUID(), decision_id: randomUUID(), grant_key: randomUUID(), payment_id: randomUUID(),
    order_ref: randomUUID(), kind: 'grant', desired_version: 1, action: 'grant_access', action_ref: productRef,
    target_ref: 'wallet:' + network + ':' + buyer, payload, delivery_status: 'pending', execution_status: 'pending',
    created_at: now, updated_at: now, ...changes,
  };
  command.payload_hash = sha256(canonicalJson(command.payload));
  return command;
}

function event(command) {
  return {
    ...scope, schema_type: 'stablepay.event.v1', event_id: randomUUID(), type: 'fulfillment.requested',
    occurred_at: command.created_at, resource_id: command.command_id, resource_version: command.desired_version,
    data: { kind: 'fulfillment_command', command },
  };
}

// Only the remote claim and result endpoints are simulated. The worker, inbox and transactions use the installed SDK.
function platform() {
  const reports = new Map();
  const claims = [], reportCalls = [];
  return {
    reports, claims, reportCalls,
    async claimFulfillment(id, body, key) {
      assert.equal(key, 'claim:' + body.execution_id);
      claims.push(id);
      return {
        command_id: id, claim_id: randomUUID(), execution_id: body.execution_id, decision: 'execute', valid: true,
        generation: 1, decision_version: 1, desired_version: body.expected_desired_version,
        issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
        reason_codes: ['CURRENT_EXECUTION_AUTHORIZED'],
      };
    },
    async reportFulfillmentResult(id, body, key) {
      assert.equal(key, 'result:' + body.execution_id);
      reportCalls.push(id);
      if (!reports.has(id)) reports.set(id, { command_id: id, result_id: randomUUID(), ...body });
      const receipt = reports.get(id);
      assert.equal(receipt.execution_id, body.execution_id);
      return receipt;
    },
  };
}

test('hosted access uses signed commands and the merchant-authenticated wallet', async t => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'Provide a disposable PostgreSQL DATABASE_URL for this test');
  const schema = 'pass_' + randomBytes(12).toString('hex');
  const admin = new pg.Pool({ connectionString });
  await admin.query('CREATE SCHEMA ' + schema);
  const openPool = () => new pg.Pool({ connectionString, options: '-c search_path=' + schema });
  let pool = openPool();
  t.after(async () => {
    await pool.end();
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  });
  await initializeHostedPass(pool);
  const client = platform();
  const buyerSession = 'session=' + randomUUID(), otherSession = 'session=' + randomUUID();
  const sessions = new Map([[buyerSession, buyer], [otherSession, otherBuyer]]);
  const config = {
    scope, client, keyId, secret, linkId, productRef,
    async getVerifiedWallet(request) {
      const address = sessions.get(request.headers.get('cookie'));
      return address ? { network_id: network, address } : null;
    },
  };
  let service = createHostedPass({ ...config, pool });
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request('http://localhost/events', {
        method: req.method, headers: req.headers, body: Buffer.concat(chunks),
      });
      const response = await service.webhook(request);
      res.writeHead(response.status);
      res.end(await response.text());
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function post(message, signingKey = secret, deliveryId = randomUUID(), signedAt = Math.floor(Date.now() / 1000)) {
    const body = Buffer.from(canonicalJson(message));
    const headers = signWebhook(body, message.event_id, deliveryId, signedAt, keyId, signingKey);
    return fetch('http://127.0.0.1:' + server.address().port + '/events', { method:'POST', headers, body });
  }
  const purchase = grant(), original = event(purchase);
  const supplied = new URLSearchParams({
    wallet: buyer, user_id: buyer, order_id: purchase.order_ref, grant_key: purchase.grant_key, tx_hash: '0x' + 'ab'.repeat(32),
  });
  function access(session, handler = service) {
    return handler.access(new Request('http://localhost/access?' + supplied, { headers: session ? { cookie: session } : {} }));
  }
  async function rowCount(table) {
    return (await pool.query('SELECT count(*)::int AS n FROM ' + table)).rows[0].n;
  }

  await t.test('reject signed out-of-scope inputs and unauthenticated or unrelated wallets', async () => {
    assert.equal((await post(original, randomBytes(32))).status, 401);
    assert.equal((await post({ ...original, project_id: randomUUID() })).status, 403);
    assert.equal((await post(event(grant({ project_id: randomUUID() })))).status, 403);
    for (const change of [
      { action: 'grant_plan' }, { action_ref: 'other-pass' },
      { payload: { link_id: randomUUID(), product_ref: productRef } },
      { payload: { link_id: linkId, product_ref: 'other-pass' } },
      { target_ref: 'wallet:eip155:1:' + buyer }, { target_ref: buyer },
      { target_ref: 'wallet:' + network + ':not-an-address' }, { target_ref: 'wallet:' + network + ':0x' + '0'.repeat(40) },
    ]) assert.equal((await post(event(grant(change)))).status, 422);
    assert.equal(await rowCount('merchant_commands'), 0);
    assert.equal((await access()).status, 401);
    assert.equal((await access(buyerSession)).status, 403);
  });

  await t.test('a restarted worker delivers the result; replaying the signed event keeps the same pass', async () => {
    const firstTimestamp = Math.floor(Date.now() / 1000) - 1;
    const first = await post(original, secret, randomUUID(), firstTimestamp);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).duplicate, false);
    const secondWorker = createHostedPass({ ...config, pool }).worker;
    const leases = await Promise.all([service.worker.processCommand(), secondWorker.processCommand()]);
    assert.deepEqual(leases.sort(), [false, true]);
    assert.equal(await rowCount('hosted_access_grants'), 1);
    assert.equal(client.reports.size, 0);
    await pool.end();
    pool = openPool();
    service = createHostedPass({ ...config, pool });
    assert.equal(await service.worker.deliverResult(), true);
    const receipt = client.reports.get(purchase.command_id);
    assert.equal(receipt.result, 'applied');

    // The platform signs the same immutable event body for a new delivery attempt.
    const redelivery = await post(original);
    assert.equal(redelivery.status, 200);
    assert.equal((await redelivery.json()).duplicate, true);
    assert.deepEqual(await service.worker.tick(), { command:false, receipt:false });
    assert.deepEqual(client.claims, [purchase.command_id]);
    assert.deepEqual(client.reportCalls, [purchase.command_id]);
    assert.equal(await rowCount('merchant_event_inbox'), 1);
    assert.equal(await rowCount('merchant_commands'), 1);
    assert.equal(await rowCount('hosted_access_grants'), 1);
    const outbox = await pool.query('SELECT delivery_state,platform_receipt_id FROM merchant_result_outbox');
    assert.deepEqual(outbox.rows, [{ delivery_state:'delivered', platform_receipt_id:receipt.result_id }]);
    const allowed = await access(buyerSession);
    assert.equal(allowed.status, 200);
    const data = await allowed.json();
    assert.equal(data.active, true);
    assert.equal(data.product_ref, productRef);
    assert.equal((await access(otherSession)).status, 403);
    assert.equal((await access()).status, 401);
    const otherProject = createHostedPass({ ...config, pool, scope: { ...scope, project_id: randomUUID() } });
    assert.equal((await access(buyerSession, otherProject)).status, 403);
  });

  await t.test('synthetic revoke and reinstate commands preserve the original grant and monotonic version', async () => {
    // Hosted checkout has no automatic refund/revoke policy. These fixtures exercise explicit versioned commands.
    async function advance(kind, version, changes = {}) {
      const command = grant({ ...purchase, command_id:randomUUID(), decision_id:randomUUID(), kind, desired_version:version, ...changes });
      assert.equal((await post(event(command))).status, 200);
      assert.deepEqual(await service.worker.tick(), { command:true, receipt:true });
      return client.reports.get(command.command_id).result;
    }
    assert.equal(await advance('revoke', 2), 'applied');
    assert.equal((await access(buyerSession)).status, 403);
    assert.equal(await advance('reinstate', 3), 'applied');
    assert.equal((await access(buyerSession)).status, 200);
    assert.equal(await advance('revoke', 2), 'noop');
    assert.equal((await access(buyerSession)).status, 200);
    assert.equal(await advance('reinstate', 4, { target_ref: 'wallet:' + network + ':' + otherBuyer }), 'failed');
    assert.equal((await access(otherSession)).status, 403);
    assert.equal(await rowCount('hosted_access_grants'), 1);
  });
});
