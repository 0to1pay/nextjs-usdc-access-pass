# Grant access after a hosted Base Sepolia payment

[한국어](README.ko.md)

Connect a fixed-price hosted payment link to a Next.js app that already authenticates its members. The webhook receives a signed command, then the merchant worker records the pass for the paying wallet. Your existing server can then protect a page or download by looking up the wallet verified for the current member. This example accepts Base Sepolia test USDC purchases. No real funds are collected.

### Set up the merchant worker

1. Use Node.js 22.20+ and PostgreSQL. Give this worker its own database or schema in your existing PostgreSQL deployment. The SDK workers consume a shared inbox within each schema. Deploy one configuration for one test project, link and product. Keep workers for other links or the root demo on their own schemas.
2. In the [test dashboard](https://pay.0to1pay.com/merchant?lang=en#payment-links), configure Base Sepolia receiving addresses and a dedicated HTTPS webhook for `fulfillment.requested`. Create the fixed-price link with that endpoint. See the [hosted link guide](https://0to1pay.com/guides/hosted-payment-links?lang=en) for the buyer button and wallet recovery.
3. From this folder run `npm ci` and `cp .env.example .env`. Set the database URL and the test project's merchant and project IDs. Use a project test API key with `fulfillment:execute` and `fulfillment:results`. Copy the endpoint's signing key ID and base64url signing secret to `WEBHOOK_KEY_ID` and `WEBHOOK_SECRET`. Set `HOSTED_LINK_ID` to the UUID in the issued link and `HOSTED_PRODUCT_REF` to its exact product code. Load these variables on the server only.
4. Run `npm run migrate`, then start `npm run worker` alongside your app. Keep the worker running to apply commands and deliver their results. Use the buyer-facing URL from the dashboard for your purchase button.

### Connect the two handlers

Copy this folder into the Next.js server project, install its dependencies there or retain the nested package, and make one server-only module available to your routes. The two functions in `my-app/auth` below are adapters to **your** existing login and verified-wallet store.

```js
// lib/hosted-pass.js
import 'server-only';
import { configureHostedPass, connectDatabase } from '../examples/hosted-access-pass/service.mjs';
import { currentMember, verifiedWalletForMember } from './my-app/auth';

export const hostedPass = configureHostedPass(connectDatabase(), async request => {
  const member = await currentMember(request);
  if (!member) return null;
  return verifiedWalletForMember(member.id); // {network_id: 'eip155:84532', address} or null
});
```

```js
// app/api/webhooks/0to1pay/route.js — register this HTTPS URL on the dedicated endpoint
import { hostedPass } from '@/lib/hosted-pass';
export const runtime = 'nodejs';
export const POST = hostedPass.webhook;
```

```js
// app/api/member-download/route.js — check the grant on the protected resource itself
import { hostedPass } from '@/lib/hosted-pass';
import { openMemberDownload } from '@/lib/my-app/content';
export const runtime = 'nodejs';
export async function GET(request) {
  const access = await hostedPass.access(request);
  if (!access.ok) return access;
  return openMemberDownload(); // return the protected file with private, no-store caching
}
```

Your app must authenticate the current member and verify wallet ownership before returning a wallet. For example, have the signed-in member sign an expiring, one-time challenge bound to your origin, session, network and wallet. Consume it once on the server and keep the association unique. The example reads that association through your adapter. It supplies no login or license key. A purchase can arrive before account linking. Once linked, only the original paying wallet can read that grant. The access check returns 401 for a missing authenticated wallet, 403 for a different wallet or no active pass, and 200 for access. A query-supplied user ID, wallet, order number or transaction hash grants no access.

### What is recorded

The webhook verifies the raw request body and checks the test project, configured link/product and Base Sepolia wallet target. A 200 acknowledges persistence in the SDK inbox. The worker obtains an execution claim and records access and the result to be sent in one database transaction. Duplicate deliveries or restarting the worker after that commit keep one grant per order. The reference grants ongoing access to this product. Your app owns any expiry or refund policy. Hosted links currently request merchant review if payment eligibility is lost. The explicit, versioned revoke and reinstate paths exercised in the test do not implement automatic refunds.

### Verify locally

Use a disposable PostgreSQL database. Its user needs permission to create and drop a test schema. From this folder run `npm ci`, then `DATABASE_URL=postgresql://… npm test`. The test uses loopback HTTP, real SDK signatures and PostgreSQL. It simulates the platform claim/result transport and the app's authenticated wallet sessions. No wallet or on-chain funds are needed. [Separate public testnet purchase evidence](../../docs/hosted-payment-link-receipt.md)
