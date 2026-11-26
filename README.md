# Sell access passes in Next.js with USDC

이 Next.js 예제에서 이용권 결제를 직접 시험하려면 Base Sepolia 지갑에 0.01 테스트 USDC와 가스용 테스트 ETH가 필요합니다. 체인에서 송금이 확인되면 가맹점 앱이 서명된 웹훅을 받고, 워커가 주문당 이용권 한 개를 지급합니다. 테스트넷 전용이어서 실제 판매 대금은 받을 수 없습니다.

[지갑 없이 완료된 주문의 송금 영수증 보기](https://base-sepolia.blockscout.com/tx/0xc68f0de5336ad234485529d939a4ac68242e00aaa013061c59189118df4500f5) · [결제 방식 비교](https://0to1pay.com/guides/nextjs-access-pass-payments?lang=ko) · [한국어 설치 가이드](README.ko.md#내-서비스에서-실행하기)

Add paid access to a Next.js app. This testnet checkout lets a reader pay **0.01 test USDC on Base Sepolia** to unlock a members’ page. The Next.js server creates the order and quote. After 0to1pay confirms the transfer, a signed webhook arrives at your app and a worker grants the pass. Reloading the page or redelivering that webhook leaves the original purchase with one pass.

This starter is for apps whose buyers already use a crypto wallet. The hosted beta uses test tokens and collects no real sales revenue. If you are choosing how to charge international customers, the payment guide compares wallet checkout with cards and merchant-of-record services. [Compare payment options for a Next.js access pass](https://0to1pay.com/guides/nextjs-access-pass-payments?lang=en)

- **Explore without a wallet.** See how an order, a confirmed transfer, a signed webhook and an entitlement fit together. The linked receipt shows the on-chain transfer. [Official Next.js Quickstart](https://0to1pay.com/docs?lang=en#nextjs-quickstart) · [Integration guide](https://0to1pay.com/guides/nextjs-base-usdc?lang=en#completed-order) · [Public transfer receipt](https://base-sepolia.blockscout.com/tx/0xc68f0de5336ad234485529d939a4ac68242e00aaa013061c59189118df4500f5)
- **Try your own wallet.** Open the hosted checkout, pay with test USDC and open the members’ page. The public demo runs this example. [Try checkout](https://0to1pay.com/demo/base-usdc?lang=en)

## Run your own checkout

You need Node.js 22.20 or later, a writable PostgreSQL database, a public HTTPS endpoint that forwards the raw webhook request, and a separate worker process. The buyer needs a Base Sepolia wallet with 0.01 test USDC and test ETH for gas. The example uses chain ID `84532` and USDC contract `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

1. Create a project in the dashboard. Copy the merchant ID and project ID and issue a **test server API key**. [Merchant dashboard](https://pay.0to1pay.com/merchant?lang=en)

2. In the starter directory, install the locked dependencies and create your local configuration.

   ```sh
   npm ci
   cp .env.example .env
   ```

3. Set `DATABASE_URL`, `MERCHANT_ID`, `PROJECT_ID`, and `ZERO_TO_ONE_PAY_API_KEY` in `.env`. Keep the test server key on the server. Set `APP_ORIGIN` to the exact browser origin (the default is `http://localhost:3000`). Set `WEBHOOK_URL` to a public HTTPS URL that forwards the original body and signature headers to `POST /api/webhooks/0to1pay`.

4. Run setup and start the app. Setup creates the database tables, registers the webhook and prepares one test receiving address. Keep the generated `.merchant/` directory private and persistent.

   ```sh
   npm run setup
   npm run dev
   ```

5. In a second terminal in the same directory, run the worker with the same configuration.

   ```sh
   npm run worker
   ```

6. Open your app, authorize the checkout, send the payment once and sign the transaction proof with the paying wallet. When your pass is active, open the members’ page. Before testing another independent order, prepare its single-use receiving address with `npm run recipient`.

## Fulfillment and recovery

The webhook handler verifies the signature over the raw body and saves the command to the durable inbox before acknowledging delivery. The worker writes the pass and its execution record in one PostgreSQL transaction. If the worker stops, restart it to process the saved inbox. The members’ page checks the current guest’s entitlement on each request. [Webhook handler](app/api/webhooks/0to1pay/route.js) · [Merchant fulfillment](lib/merchant.mjs) · [Protected route](app/api/pass/route.js)

If the wallet already sent USDC, reopen the same checkout and finish the proof for the existing transfer. After cookies are cleared, use **Recover purchase** with the original paying wallet and the order or payment reference, or the transfer hash when it identifies one order. The buyer must sign a fresh challenge before access moves to a new session. [Recovery guide](https://0to1pay.com/guides/nextjs-base-usdc?lang=en)

## Cost and supported networks

The hosted beta uses test tokens and has zero real-money cost. The free Sandbox includes 1,000 counted requests per UTC calendar month. A basic new checkout uses two counted requests (one order and one quote), so 1,000 requests cover up to 500 starts if nothing else consumes the allowance. Project plans are prepaid software subscriptions. This starter implements Base Sepolia USDC. The platform also supports Ethereum Sepolia USDC and TRON Nile USDT. [Pricing and usage](https://0to1pay.com/pricing?lang=en)

## Source and license

The application and its lockfile come from the official public example ZIP with SHA-256 `75028009d3a73fc9925bde724eb36d56e9098baff7ae311d5b1111bf4fff5a78`. Both 0to1pay SDKs are pinned to `3.1.2`, Next.js to `16.4.6`, React and React DOM to `19.3.1`, pg to `8.23.1`, and viem to `2.58.0`. To check the receipt matching rules locally, run `node --test test/transfer-receipt.test.mjs`. [Official source archive](https://0to1pay.com/examples/nextjs-base-usdc.zip) · [Dependency manifest](package.json)

Application code is distributed under the MIT license. The bundled DM Sans font uses the SIL Open Font License. [Application license](LICENSE) · [Font license](app/fonts/DM-Sans-LICENSE.txt)
