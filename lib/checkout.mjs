import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'viem';
import { chainIntentClaimMessage } from '@0to1pay/server-sdk';
import { transaction } from '@0to1pay/fulfillment-sdk';
import { AMOUNT, api, config, db, NETWORK, required, scope, TOKEN } from './merchant.mjs';
import { registerTestRecipient } from './provision.mjs';

const wallet = /^0x[0-9a-f]{40}$/i;
const txid = /^0x[0-9a-f]{64}$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recoveryLifetime = 5 * 60 * 1000;
const signature = /^0x[0-9a-f]{130}$/i;
export const hash = text => createHash('sha256').update(text).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const cookieName = 'base_usdc_guest';
export class CheckoutError extends Error {
  constructor(code,status=400) { super(code); this.status=status; }
}
function check(condition, code, status) {
  if (!condition) throw new CheckoutError(code,status);
}
export async function readOrder(token) {
  if (!token) return {entitled:false};
  const {rows:[order]} = await db().query(`SELECT o.*,COALESCE(p.active,false) AS entitled, p.active IS FALSE AS revoked,
    CASE WHEN o.submitted AND p.order_id IS NULL THEN EXISTS (
      SELECT 1 FROM merchant_commands c WHERE c.command->>'kind'='grant' AND c.command->>'order_ref'=o.id::text
      AND c.command->>'payment_id'=o.payment_id::text AND c.command->>'target_ref'=o.guest_id::text
    ) ELSE false END AS fulfillment_received
    FROM pass_orders o LEFT JOIN passes p ON p.order_id=o.id WHERE o.session_hash=$1`,[hash(token)]);
  return order ? {order_ref:order.id,payment_id:order.payment_id,payer_address:order.payer_address,...order.terms,
    authorized:order.authorized,broadcast_reserved:Boolean(order.reservation_id),broadcast_hint:order.broadcast_hint,transaction_id:order.transaction_id,
    submitted:order.submitted,entitled:order.entitled,revoked:order.revoked,fulfillment_received:order.fulfillment_received} : {entitled:false};
}

async function createOrder(token,payer) {
  await transaction(db(),async tx => {
    // Bound spending of demo API quota across sessions and concurrent replicas.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('base-pass:new-order'))");
    const {rows:[prior]} = await tx.query('SELECT payer_address FROM pass_orders WHERE session_hash=$1',[hash(token)]);
    if (prior) { check(prior.payer_address === payer,'ORIGINAL_WALLET_REQUIRED',409); return; }
    const {rows:[usage]} = await tx.query("SELECT count(*)::int AS n FROM pass_orders WHERE created_at > now() - interval '24 hours'");
    check(usage.n < 50,'DEMO_DAILY_ORDER_LIMIT',429);
    await tx.query('INSERT INTO pass_orders(id,guest_id,session_hash,payer_address,checkout_ref) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(),randomUUID(),hash(token),payer,newToken()]);
  });
}

async function begin(tx, o) {
  if (o.terms) return;
  const client = api(), cfg = config();
  if (process.env.AUTO_TEST_RECIPIENTS === 'true') await registerTestRecipient(cfg,o.id);
  const pay = await client.createPayment({
    order_ref:o.id,order_revision:1,customer_ref:o.guest_id,price:{asset:'stable:USDC',scale:6,amount_atomic:AMOUNT},
    allowed_connections:[cfg.connection_id],policy_ref:'digital_goods_standard_v1',expires_in_seconds:1800,
    fulfillment:{mode:'merchant_action',action:'grant_plan',action_ref:'base_pass',target_ref:o.guest_id,
      endpoint_id:cfg.endpoint_id,payload:{plan:'base-pass',compensation:'revoke_reversible_entitlement'}},
  }, 'order:' + o.id);
  const quote = await client.createQuote(pay.payment_id,{connection_id:cfg.connection_id,presentment_asset:'stable:USDC',
    expires_in_seconds:900},'quote:' + o.id);
  const {attempt} = await client.createAttempt(pay.payment_id,{connection_id:cfg.connection_id,quote_id:quote.quote_id},'attempt:' + o.id);
  const terms = attempt.next_action;
  check(pay.environment === 'test' && quote.environment === 'test' && quote.project_id === cfg.project_id &&
    terms.type === 'transfer_instruction' && terms.quote_id === quote.quote_id && terms.network_id === NETWORK &&
    terms.chain_id === 84532 && terms.token_address.toLowerCase() === TOKEN.toLowerCase() &&
    terms.payable.amount_atomic === AMOUNT && terms.payable.scale === 6 && wallet.test(terms.recipient),'UNEXPECTED_TEST_QUOTE',502);
  const intent = await client.createChainIntent(quote.quote_id,{checkout_session_ref:o.checkout_ref,payer_address:o.payer_address},'intent:' + o.id);
  check(intent.quote_id === quote.quote_id && intent.family === 'evm' && intent.payer_address.toLowerCase() === o.payer_address,
    'UNEXPECTED_INTENT',502);
  await tx.query('UPDATE pass_orders SET payment_id=$2,terms=$3 WHERE id=$1',[o.id,pay.payment_id,JSON.stringify({
    quote_id:quote.quote_id,intent_id:intent.intent_id,network_id:NETWORK,chain_id:84532,token:TOKEN,
    recipient:terms.recipient,amount_atomic:AMOUNT,expires_at:intent.expires_at,signing_message:intent.signing_message,
  })]);
}
// A challenge authenticates one order in one browser, including after a cookie reset.
// The secret checkout reference stays in the merchant database. A successful proof
// increments the order revision and invalidates both the old cookie and that proof.
function recoveryMessage(o, sessionHash, challenge) {
  const tenant = scope();
  return [
    'Recover access to a 0to1pay demo purchase',
    'Origin: ' + required('APP_ORIGIN'), 'Merchant: ' + tenant.merchant_id, 'Project: ' + tenant.project_id,
    'Network: ' + NETWORK, 'Order: ' + o.id, 'Payment: ' + o.payment_id,
    'Paying wallet: ' + o.payer_address, 'New browser: ' + sessionHash,
    'Revision: ' + challenge.version, 'Nonce: ' + challenge.nonce,
    'Expires: ' + new Date(challenge.expires_at).toISOString(),
    'This signature restores this purchase in this browser. No transfer is requested.',
  ].join('\n');
}
function tag(o, message) {
  return createHmac('sha256', o.checkout_ref).update(message).digest();
}
async function recoverSession(tx, sessionHash, input) {
  if (input.action === 'recovery-challenge') {
    const ref = typeof input.reference === 'string' ? input.reference.trim().toLowerCase() : '';
    check(uuid.test(ref) || txid.test(ref),'ENTER_ORDER_PAYMENT_OR_TRANSACTION_ID');
    check(typeof input.payer_address === 'string' && wallet.test(input.payer_address),'INVALID_PAYER');
    check(input.recipient == null || (typeof input.recipient === 'string' && wallet.test(input.recipient)), 'INVALID_TRANSFER_RECIPIENT');
    const recipient = input.recipient?.toLowerCase() ?? null;
    const {rows} = await tx.query(`SELECT * FROM pass_orders WHERE authorized AND reservation_id IS NOT NULL
      AND payer_address=$1 AND (id::text=$2 OR payment_id::text=$2 OR transaction_id=$2 OR broadcast_hint=$2
      OR ($3::text IS NOT NULL AND lower(terms->>'recipient')=$3)) LIMIT 2`,
      [input.payer_address.toLowerCase(), ref, txid.test(ref) ? recipient : null]);
    // A saved wallet hint cannot override a receipt for a different order recipient.
    check(rows.length === 1 && (!recipient || rows[0].terms?.recipient?.toLowerCase() === recipient),
      'USE_ORIGINAL_WALLET_AND_MERCHANT_ORDER_REFERENCE',404);
    const o = rows[0], challenge = {order_ref:o.id,version:o.recovery_version,nonce:newToken(),expires_at:Date.now()+recoveryLifetime};
    const message = recoveryMessage(o, sessionHash, challenge);
    return {challenge:{...challenge,tag:tag(o,message).toString('hex')},signing_message:message};
  }
  const c = input.challenge, now = Date.now();
  check(c && typeof c.order_ref === 'string' && uuid.test(c.order_ref) && Number.isSafeInteger(c.version) && Number.isSafeInteger(c.expires_at) &&
    c.expires_at > now && c.expires_at <= now+recoveryLifetime && typeof c.nonce === 'string' && /^[\w-]{43}$/.test(c.nonce) &&
    typeof c.tag === 'string' && /^[a-f0-9]{64}$/.test(c.tag) && typeof input.signature === 'string' && signature.test(input.signature),'FRESH_RECOVERY_SIGNATURE_REQUIRED',403);
  const {rows:[o]} = await tx.query('SELECT * FROM pass_orders WHERE id=$1 AND authorized AND reservation_id IS NOT NULL FOR UPDATE',[c.order_ref]);
  check(o && o.recovery_version === c.version,'FRESH_RECOVERY_SIGNATURE_REQUIRED',403);
  const message = recoveryMessage(o, sessionHash, c);
  check(timingSafeEqual(Buffer.from(c.tag,'hex'),tag(o,message)),'FRESH_RECOVERY_SIGNATURE_REQUIRED',403);
  const valid = await verifyMessage({address:o.payer_address,message,signature:input.signature}).catch(() => false);
  check(valid,'ORIGINAL_WALLET_SIGNATURE_REQUIRED',403);
  const existing = await tx.query('SELECT id FROM pass_orders WHERE session_hash=$1 AND id<>$2',[sessionHash,o.id]);
  check(!existing.rowCount,'USE_A_NEW_BROWSER_PROFILE_TO_RECOVER_ANOTHER_ORDER',409);
  await tx.query('UPDATE pass_orders SET session_hash=$2,recovery_version=recovery_version+1 WHERE id=$1',[o.id,sessionHash]);
}
export async function mutate(token,input) {
  if (input.action === 'open') {
    check(typeof input.payer_address === 'string' && wallet.test(input.payer_address) && !/^0x0{40}$/i.test(input.payer_address),'INVALID_PAYER');
    await createOrder(token,input.payer_address.toLowerCase());
  }
  const special = await transaction(db(),async tx => {
    if (input.action === 'recovery-challenge' || input.action === 'recover-session') {
      return recoverSession(tx, hash(token), input);
    }
    const {rows:[o]} = await tx.query('SELECT * FROM pass_orders WHERE session_hash=$1 FOR UPDATE',[hash(token)]);
    check(o,'OPEN_ORDER_FIRST',409);
    check(input.order_ref === undefined || input.order_ref === o.id,'ORDER_CHANGED',409);
    if (input.action === 'open') { await begin(tx,o); return; }
    check(o.terms,'OPEN_ORDER_FIRST',409);
    const t = o.terms, client = api();
    switch (input.action) {
      case 'restart':
        check(Date.parse(t.expires_at) <= Date.now() && !o.reservation_id && !o.submitted && !o.transaction_id,
          'CHECKOUT_STILL_ACTIVE',409);
        // Burn only the expired unused session reference, preserving the old order for audit.
        await tx.query('UPDATE pass_orders SET session_hash=$2 WHERE id=$1',[o.id,hash(newToken())]);
        return {restart:true};
      case 'authorize':
        check(signature.test(input.signature),'INVALID_SIGNATURE');
        if (!o.authorized) {
          await client.authorizeChainIntent(t.quote_id,t.intent_id,{checkout_session_ref:o.checkout_ref,signature:input.signature},'auth:' + o.id);
          await tx.query('UPDATE pass_orders SET authorized=true WHERE id=$1',[o.id]);
        }
        break;
      case 'reserve': {
        check(o.authorized && !o.reservation_id && !o.transaction_id,'TRANSFER_ALREADY_RESERVED_OR_UNAUTHORIZED',409);
        check(Date.parse(t.expires_at) > Date.now(),'QUOTE_EXPIRED',409);
        const id = randomUUID();
        await tx.query('UPDATE pass_orders SET reservation_id=$2 WHERE id=$1',[o.id,id]);
        return {reservation_id:id};
      }
      case 'remember-hash':
        check(o.authorized && o.reservation_id && input.reservation_id === o.reservation_id &&
          typeof input.transaction_id === 'string' && txid.test(input.transaction_id),
          'INVALID_TRANSFER',409);
        await tx.query('UPDATE pass_orders SET broadcast_hint=$2 WHERE id=$1',[o.id,input.transaction_id.toLowerCase()]);
        break;
      case 'release':
        check(o.reservation_id && input.reservation_id === o.reservation_id && !o.transaction_id && !o.broadcast_hint,'RESERVATION_CHANGED',409);
        await tx.query('UPDATE pass_orders SET reservation_id=NULL WHERE id=$1',[o.id]);
        break;
      case 'claim-message':
      case 'submit': {
        check(o.authorized && o.reservation_id && typeof input.transaction_id === 'string' && txid.test(input.transaction_id),'INVALID_TRANSFER',409);
        const id = input.transaction_id.toLowerCase();
        if (input.action === 'claim-message') {
          // A mistyped hash in the recovery form must not lock the order before wallet proof.
          check(!o.transaction_id || o.transaction_id === id,'SUBMITTED_HASH_DIFFERS',409);
          return {signing_message:chainIntentClaimMessage({family:'evm',signing_message:t.signing_message},id)};
        }
        check(signature.test(input.signature),'INVALID_SIGNATURE');
        check(!o.transaction_id || o.transaction_id === id,'SUBMITTED_HASH_DIFFERS',409);
        if (!o.submitted) {
          await client.submitChainIntent(t.quote_id,t.intent_id,{checkout_session_ref:o.checkout_ref,transaction_id:id,
            signature:input.signature},'submit:' + o.id + ':' + id.slice(2,18));
          await tx.query('UPDATE pass_orders SET submitted=true,transaction_id=$2 WHERE id=$1',[o.id,id]);
        }
        break;
      }
      default: throw new CheckoutError('UNKNOWN_ACTION');
    }
  });
  return special || readOrder(token);
}
