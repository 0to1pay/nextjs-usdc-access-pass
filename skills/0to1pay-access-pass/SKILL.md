---
name: 0to1pay-access-pass
description: Integrate a 0to1pay testnet payment link or SDK checkout into a Next.js app and grant the purchasing wallet access once after a signed webhook.
---

# 0to1pay access passes for Next.js

Use this workflow for a wallet checkout prototype. The hosted beta accepts test tokens, so a merchant that needs to collect real revenue today needs a live payment provider. Buyers need a wallet, test tokens and test gas on the selected network.

## Choose the checkout

- **Hosted link.** The merchant sets the product, fixed price, test network and active fulfillment webhook in the dashboard. Put the issued public URL on the app’s buy button. Each new order uses one unused merchant receiving address registered on that network. The button needs no checkout SDK. [Hosted payment links](https://0to1pay.com/guides/hosted-payment-links?lang=en) · [한국어 가이드](https://0to1pay.com/guides/hosted-payment-links?lang=ko)
- **Custom checkout.** Use the server SDK when the app needs to create the order and quote. The template’s Base Sepolia USDC demo builds its own checkout and binds the order to its guest. Its existing worker handles the demo’s `grant_plan` command. [Next.js Quickstart](https://0to1pay.com/guides/nextjs-base-usdc?lang=en)

## Fulfill a hosted order

Verify the signed webhook using the raw HTTP body, store the event durably and acknowledge it. The merchant worker fetches the fulfillment command in its project. Check `action === 'grant_access'`, the expected product in `action_ref` and the verified wallet in `target_ref`. Link that wallet to a signed-in member using a one-time wallet ownership challenge.

Use a unique `grant_key` for the durable entitlement. Commit the pass and the merchant’s result together, then report the result to the platform. On redelivery or a worker restart, reuse the recorded result. The merchant defines access duration and applies any revocation to the same entitlement. [Template webhook receiver](../../app/api/webhooks/0to1pay/route.js) · [Template worker](../../scripts/worker.mjs)

## Verify the effect

Exercise the merchant handler twice with the same signed event. Check delivery acknowledgements, one pass for the original owner, and one applied result. Test an unrelated account separately. An on-chain receipt proves the token transfer. The merchant ledger establishes the access outcome. [Recorded test purchase and replay](../../docs/hosted-payment-link-receipt.md)
