import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { ZeroToOnePayClient } from '@0to1pay/server-sdk';
import { FulfillmentInbox, FulfillmentWorker, migrateFulfillmentInbox } from '@0to1pay/fulfillment-sdk';

export const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const AMOUNT = '10000'; // 0.01 USDC, six decimal places.
export const NETWORK = 'eip155:84532';
export const directory = resolve('.merchant');
export function required(name) {
  if (process.env[name + '_FILE']) return readFileSync(process.env[name + '_FILE'],'utf8').trim();
  if (!process.env[name]) throw new Error('Configure ' + name + ' in .env');
  return process.env[name];
}
export function api() {
  const apiKey = required('ZERO_TO_ONE_PAY_API_KEY');
  if (!apiKey.startsWith('sp_test_')) throw new Error('This example requires a test project key');
  return new ZeroToOnePayClient({origin:process.env.ZERO_TO_ONE_PAY_ORIGIN || 'https://api.0to1pay.com', apiKey});
}
export function scope() {
  return {merchant_id:required('MERCHANT_ID'),project_id:required('PROJECT_ID'),environment:'test'};
}
export function config() {
  const cfg = JSON.parse(readFileSync(resolve(directory,'config.json'), 'utf8'));
  const tenant = scope();
  if (cfg.merchant_id !== tenant.merchant_id || cfg.project_id !== tenant.project_id ||
      cfg.origin !== (process.env.ZERO_TO_ONE_PAY_ORIGIN || 'https://api.0to1pay.com')) {
    throw new Error('Stored setup belongs to another project or API');
  }
  return cfg;
}
let pool;
export function db() {
  return pool ??= new pg.Pool({connectionString:required('DATABASE_URL'),max:8});
}
export async function migrate() {
  await migrateFulfillmentInbox(db());
  await db().query(`CREATE TABLE IF NOT EXISTS pass_orders (
    id uuid PRIMARY KEY, guest_id uuid NOT NULL UNIQUE, session_hash text NOT NULL UNIQUE,
    payer_address text NOT NULL, checkout_ref text NOT NULL, payment_id uuid UNIQUE, terms jsonb,
    authorized boolean NOT NULL DEFAULT false, reservation_id uuid, transaction_id text UNIQUE,
    submitted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS demo_grant_by_order ON merchant_commands ((command->>'order_ref')) WHERE command->>'kind'='grant';
  ALTER TABLE pass_orders ADD COLUMN IF NOT EXISTS broadcast_hint text,
    ADD COLUMN IF NOT EXISTS recovery_version integer NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS passes (
    order_id uuid PRIMARY KEY REFERENCES pass_orders(id), grant_key text NOT NULL UNIQUE,
    active boolean NOT NULL, version integer NOT NULL
  )`);
}
export function inbox() {
  const cfg = config();
  return new FulfillmentInbox(db(), {scope:scope(), keys:new Map([[cfg.key_id,{secret:Buffer.from(cfg.secret,'base64url')}]])});
}
export async function applyPass(tx, command) {
  if (command.action !== 'grant_plan' || command.action_ref !== 'base_pass' ||
      command.payload?.plan !== 'base-pass' || command.payload.compensation !== 'revoke_reversible_entitlement' ||
      Object.keys(command.payload).length !== 2) {
    return {result:'failed',error_code:'UNEXPECTED_PRODUCT'};
  }
  const match = await tx.query('SELECT id FROM pass_orders WHERE id::text=$1 AND guest_id::text=$2 AND payment_id::text=$3 FOR UPDATE',
    [command.order_ref,command.target_ref,command.payment_id]);
  if (!match.rowCount) return {result:'failed',error_code:'ORDER_MISMATCH'};
  const {rows:[prior]} = await tx.query('SELECT * FROM passes WHERE order_id=$1', [command.order_ref]);
  if (prior && prior.grant_key !== command.grant_key) return {result:'failed',error_code:'GRANT_MISMATCH'};
  if (command.kind === 'adjust' || (!prior && command.kind === 'revoke')) return {result:'noop',reason_code:'NO_EFFECT_REQUIRED'};
  if (!prior && command.kind === 'reinstate') return {result:'failed',error_code:'PASS_MISSING'};
  const active = command.kind !== 'revoke';
  if (prior && (command.desired_version <= prior.version || active === prior.active)) {
    return {result:'noop',reason_code:'NO_EFFECT_REQUIRED'};
  }
  const result = await tx.query(`INSERT INTO passes(order_id,grant_key,active,version) VALUES($1,$2,$3,$4)
    ON CONFLICT(order_id) DO UPDATE SET active=EXCLUDED.active, version=EXCLUDED.version
    RETURNING statement_timestamp() AS applied_at`, [command.order_ref,command.grant_key,active,command.desired_version]);
  return {result:'applied',applied_version:command.desired_version,effect_reference:'pass:' + command.order_ref,
    applied_at:result.rows[0].applied_at.toISOString()};
}
export function createWorker() {
  return new FulfillmentWorker({pool:db(),client:api(),apply:applyPass,renewExpiredTransactionalClaims:true});
}
