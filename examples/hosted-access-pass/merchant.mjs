import { DeliveryError, FulfillmentInbox, FulfillmentWorker, migrateFulfillmentInbox, sameScope, verifyDelivery } from '@0to1pay/fulfillment-sdk';

const network = 'eip155:84532';
const targetPattern = /^wallet:eip155:84532:(0x[0-9a-f]{40})$/;
const zeroAddress = '0x' + '0'.repeat(40);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const maxBodyBytes = 1024 * 1024;
const readHeaders = { 'Cache-Control': 'private, no-store' };

export async function initializeHostedPass(pool) {
  await migrateFulfillmentInbox(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hosted_access_grants (
      merchant_id uuid NOT NULL, project_id uuid NOT NULL,
      environment text NOT NULL CHECK (environment = 'test'),
      link_id uuid NOT NULL, product_ref text NOT NULL,
      order_ref uuid NOT NULL, payment_id uuid NOT NULL, grant_key uuid NOT NULL,
      payer_address text NOT NULL CHECK (payer_address ~ '^0x[0-9a-f]{40}$'),
      active boolean NOT NULL, desired_version bigint NOT NULL CHECK (desired_version > 0),
      PRIMARY KEY (merchant_id, project_id, environment, order_ref),
      UNIQUE (merchant_id, project_id, environment, grant_key),
      UNIQUE (merchant_id, project_id, environment, payment_id)
    );
    CREATE INDEX IF NOT EXISTS hosted_access_by_payer
    ON hosted_access_grants (merchant_id, project_id, environment, link_id, product_ref, payer_address) WHERE active
  `);
}

async function rawBody(request) {
  if (!request.body || Number(request.headers.get('content-length')) > maxBodyBytes) {
    throw new DeliveryError(413, 'INVALID_DELIVERY_SIZE');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.body) {
    length += chunk.byteLength;
    if (length > maxBodyBytes) throw new DeliveryError(413, 'INVALID_DELIVERY_SIZE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, length);
}

export function createHostedPass({pool, client, scope, keyId, secret, linkId, productRef, getVerifiedWallet}) {
  if (scope?.environment !== 'test' || !uuid.test(scope.merchant_id) || !uuid.test(scope.project_id) ||
      !uuid.test(linkId) || !/^[A-Za-z0-9._-]{1,64}$/.test(productRef ?? '') || !keyId ||
      !Buffer.isBuffer(secret) || secret.length < 32 || typeof getVerifiedWallet !== 'function') {
    throw new Error('Set the test project, hosted link, product, signing key and verified wallet adapter.');
  }
  const tenant = [scope.merchant_id, scope.project_id, scope.environment];
  const options = {scope, keys:new Map([[keyId, {secret}]]), maxBodyBytes};
  const inbox = new FulfillmentInbox(pool, options);

  function payerFor(command) {
    if (!sameScope(scope, command) || !['grant', 'revoke', 'reinstate'].includes(command.kind) ||
        command.action !== 'grant_access' || command.action_ref !== productRef ||
        command.payload?.product_ref !== productRef || command.payload.link_id !== linkId ||
        Object.keys(command.payload).length !== 2 || !uuid.test(command.order_ref)) return null;
    const address = targetPattern.exec(command.target_ref)?.[1];
    return address && address !== zeroAddress ? address : null;
  }

  async function apply(tx, command) {
    const payer = payerFor(command);
    if (!payer) return {result:'failed', error_code:'UNEXPECTED_HOSTED_PASS'};
    const saved = await tx.query(`
      INSERT INTO hosted_access_grants AS g
        (merchant_id,project_id,environment,link_id,product_ref,order_ref,payment_id,grant_key,payer_address,active,desired_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (merchant_id,project_id,environment,order_ref) DO UPDATE
        SET active=excluded.active, desired_version=excluded.desired_version
        WHERE g.grant_key=excluded.grant_key AND g.payment_id=excluded.payment_id AND g.link_id=excluded.link_id
          AND g.product_ref=excluded.product_ref AND g.payer_address=excluded.payer_address
          AND g.desired_version < excluded.desired_version
      RETURNING statement_timestamp() AS applied_at`,
      [...tenant, linkId, productRef, command.order_ref, command.payment_id, command.grant_key,
        payer, command.kind !== 'revoke', command.desired_version]);
    if (!saved.rowCount) return {result:'failed', error_code:'HOSTED_PASS_CONFLICT'};
    return {result:'applied', applied_version:command.desired_version, effect_reference:'hosted-pass:' + command.grant_key,
      applied_at:saved.rows[0].applied_at.toISOString()};
  }

  async function webhook(request) {
    if (request.method !== 'POST') return new Response(null, {status:405, headers:{Allow:'POST'}});
    try {
      const body = await rawBody(request);
      const headers = Object.fromEntries(request.headers);
      // Limit this endpoint to the configured link before the SDK queues a merchant effect.
      const {command} = verifyDelivery(body, headers, options);
      if (!command) return new Response(null, {status:204});
      if (!payerFor(command)) throw new DeliveryError(422, 'UNEXPECTED_HOSTED_PASS');
      const accepted = await inbox.receive(body, headers);
      return Response.json({received:true, duplicate:accepted.duplicate});
    } catch (error) {
      if (error instanceof DeliveryError) return Response.json({error:error.code}, {status:error.status});
      return Response.json({error:'INBOX_UNAVAILABLE'}, {status:503});
    }
  }

  async function access(request) {
    if (request.method !== 'GET') return new Response(null, {status:405, headers:{...readHeaders, Allow:'GET'}});
    const wallet = await getVerifiedWallet(request);
    if (!wallet) return new Response(null, {status:401, headers:readHeaders});
    if (wallet.network_id !== network || typeof wallet.address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(wallet.address) || wallet.address.toLowerCase() === zeroAddress) {
      return new Response(null, {status:403, headers:readHeaders});
    }
    const result = await pool.query(`SELECT 1 FROM hosted_access_grants
      WHERE merchant_id=$1 AND project_id=$2 AND environment=$3 AND link_id=$4 AND product_ref=$5
        AND payer_address=$6 AND active LIMIT 1`, [...tenant, linkId, productRef, wallet.address.toLowerCase()]);
    if (!result.rowCount) return new Response(null, {status:403, headers:readHeaders});
    return Response.json({active:true, product_ref:productRef}, {headers:readHeaders});
  }

  const worker = new FulfillmentWorker({pool, client, apply, renewExpiredTransactionalClaims:true});
  return {webhook, access, worker};
}
