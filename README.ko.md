# Next.js에서 USDC로 유료 이용권 판매하기

[English](README.md)

구매자가 Base Sepolia에서 **0.01 테스트 USDC**를 보내면 회원 콘텐츠가 열리는 Next.js 예제입니다. 서버가 주문과 견적을 만들고, 0to1pay가 송금을 확인하면 가맹점 앱이 서명 웹훅을 받습니다. 워커가 원래 구매자에게 이용권 하나를 지급합니다. 새로고침하거나 같은 웹훅을 다시 받아도 하나로 유지됩니다.

구매자가 이미 코인 지갑을 사용하는 서비스에서 결제 흐름을 시험할 수 있습니다. 현재 공개 베타에서는 테스트 토큰만 사용해 실제 판매 대금은 받을 수 없습니다. 해외 판매에 필요한 카드 결제, 판매 대행, 지갑 결제 방식은 별도 가이드에서 비교할 수 있습니다. [Next.js 해외 이용권 판매 방식 비교](https://0to1pay.com/guides/nextjs-access-pass-payments?lang=ko)

**내 앱에 구매 버튼만 붙이려면** 대시보드에서 상품 링크를 만들어 버튼에 연결하세요. 이 경로에서는 가맹점이 웹훅 서명을 검증한 뒤 `grant_access` 요청에 따라 결제한 지갑에 주문당 이용권 하나를 기록합니다. 회원 계정에서 이용권을 열 때는 지갑 소유를 확인하세요. 아래 Next.js 예제는 주문과 견적을 직접 만들고 자체 `grant_plan` 워커로 지급합니다. [호스팅 테스트 결제 링크 만들기](https://0to1pay.com/guides/hosted-payment-links?lang=ko) · [가맹점의 결제·이용권 검증 기록](docs/hosted-payment-link-receipt.md)

- **지갑 없이 살펴보기.** 주문 생성, 온체인 확정, 서명 웹훅, 이용권 지급의 흐름과 실제 Base Sepolia 송금 영수증을 확인하세요. [공식 Next.js 빠른 시작](https://0to1pay.com/docs?lang=ko#nextjs-quickstart) · [연동 가이드](https://0to1pay.com/guides/nextjs-base-usdc?lang=ko#completed-order) · [공개 송금 영수증](https://base-sepolia.blockscout.com/tx/0xc68f0de5336ad234485529d939a4ac68242e00aaa013061c59189118df4500f5)
- **내 지갑으로 결제하기.** 같은 코드를 실행 중인 데모에서 테스트 USDC를 보내고 회원 콘텐츠를 열 수 있습니다. [체크아웃 체험](https://0to1pay.com/demo/base-usdc?lang=ko)

## 내 서비스에서 실행하기

Node.js 22.20 이상, 쓰기 가능한 PostgreSQL, 웹훅 원문을 전달할 공개 HTTPS 주소, 실행 상태를 유지할 워커가 필요합니다. 구매자 지갑에는 0.01 테스트 USDC와 가스용 Base Sepolia ETH를 준비하세요. 체인 ID는 `84532`, USDC 컨트랙트 주소는 `0x036CbD53842c5426634e7929541eC2318f3dCF7e`입니다.

1. 대시보드에서 프로젝트를 만들고 가맹점 ID와 프로젝트 ID를 복사하세요. 서버에서 사용할 **테스트 API 키**를 발급하세요. [가맹점 대시보드](https://pay.0to1pay.com/merchant?lang=ko)

2. 예제 디렉터리에서 의존성을 설치하고 설정 파일을 만드세요.

   ```sh
   npm ci
   cp .env.example .env
   ```

3. `.env`에 `DATABASE_URL`, `MERCHANT_ID`, `PROJECT_ID`, `ZERO_TO_ONE_PAY_API_KEY`를 입력하세요. 테스트 서버 키는 서버에만 보관하세요. `APP_ORIGIN`에는 브라우저에서 열 주소를 설정하세요. 기본값은 `http://localhost:3000`입니다. `WEBHOOK_URL`에는 요청 원문과 서명 헤더를 그대로 `POST /api/webhooks/0to1pay`로 전달하는 공개 HTTPS 주소를 입력하세요.

4. 초기 설정 후 앱을 실행하세요. 초기 설정은 DB 테이블을 만들고 웹훅과 첫 주문용 수취 주소를 등록합니다. 생성된 `.merchant/`는 비공개로 보관하고 재시작 후에도 유지하세요.

   ```sh
   npm run setup
   npm run dev
   ```

5. 같은 디렉터리에서 터미널을 하나 더 열고 동일한 설정으로 워커를 실행하세요.

   ```sh
   npm run worker
   ```

6. 앱에서 결제를 승인하고 한 번 송금한 뒤, 결제한 지갑에서 거래 증명에 서명하세요. 이용권이 활성화되면 회원 콘텐츠를 여세요. 다음 주문을 새로 시험할 때는 `npm run recipient`로 그 주문의 일회용 수취 주소를 준비하세요.

## 지급과 복구

웹훅 핸들러는 요청 원문의 서명을 검증하고 명령을 DB에 저장한 뒤 응답합니다. 워커는 이용권과 실행 기록을 같은 PostgreSQL 트랜잭션에 저장합니다. 워커가 멈추면 다시 실행해 대기 중인 명령을 처리할 수 있습니다. 회원 콘텐츠는 요청할 때마다 현재 게스트의 이용권을 확인합니다. [웹훅 핸들러](app/api/webhooks/0to1pay/route.js) · [지급 처리](lib/merchant.mjs) · [회원 콘텐츠 경로](app/api/pass/route.js)

이미 송금했다면 같은 주문을 다시 열어 기존 송금의 증명 서명을 완료하세요. 쿠키를 지웠다면 구매 복구에서 기존 주문 번호나 결제 ID를 사용하세요. 송금이 주문 하나에만 대응하면 거래 해시로도 찾을 수 있습니다. 새 세션에서 이용권을 열려면 원래 결제한 지갑으로 복구 요청에 서명해야 합니다. [구매 복구 가이드](https://0to1pay.com/guides/nextjs-base-usdc?lang=ko)

## 요금과 지원 망

베타는 실비 0원이며 테스트 토큰을 사용합니다. 무료 Sandbox 한도는 UTC 달력 월 기준 집계 요청 1,000회입니다. 새 결제의 기본 흐름은 주문 생성과 견적 생성에 각 1회를 사용합니다. 다른 집계 요청이 없으면 1,000회로 최대 500건을 시작할 수 있습니다. 유료 요금제는 프로젝트별 선불 소프트웨어 구독입니다. 이 예제에서는 Base Sepolia USDC를 사용합니다. 플랫폼은 Ethereum Sepolia USDC와 TRON Nile USDT도 지원합니다. [요금과 사용량](https://0to1pay.com/pricing?lang=ko)

## 소스와 라이선스

앱과 잠금 파일은 공식 공개 ZIP과 같습니다. 두 0to1pay SDK는 `3.1.2`, Next.js는 `16.4.6`, React와 React DOM은 `19.3.1`, pg는 `8.23.1`, viem은 `2.58.0`으로 고정했습니다. 송금 영수증 판별은 `node --test test/transfer-receipt.test.mjs`로 확인할 수 있습니다. [공식 소스 ZIP](https://0to1pay.com/examples/nextjs-base-usdc.zip) · [원본 SHA-256](README.md#source-and-license) · [의존성 목록](package.json)

앱 코드는 MIT, 포함된 DM Sans 글꼴은 SIL Open Font License를 적용합니다. [앱 라이선스](LICENSE) · [글꼴 라이선스](app/fonts/DM-Sans-LICENSE.txt)
