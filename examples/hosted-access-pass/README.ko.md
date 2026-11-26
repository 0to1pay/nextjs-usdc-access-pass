# Base Sepolia 결제 링크로 회원 이용권 지급하기

[English](README.md)

이미 회원 로그인이 있는 Next.js 서비스에서 고정 가격 결제 링크를 연결하는 예제입니다. 웹훅이 서명된 명령을 받으면 가맹점 워커가 결제한 지갑에 이용권을 기록하고, 가맹점 서버는 현재 회원이 소유권을 증명한 지갑으로 페이지나 다운로드 접근을 확인합니다. Base Sepolia 테스트 USDC만 사용하며 실제 판매 대금은 발생하지 않습니다.

### 가맹점 워커 준비

1. Node.js 22.20 이상과 PostgreSQL을 준비합니다. 기존 PostgreSQL 서버에 이 워커 전용 DB나 스키마를 만드세요. SDK 워커는 같은 스키마의 수신함에서 명령을 꺼내므로 이 예제에는 테스트 프로젝트 하나, 결제 링크 하나, 상품 코드 하나를 연결합니다. 다른 링크나 루트 데모의 워커에는 다른 스키마를 사용하세요.
2. [테스트 대시보드](https://pay.0to1pay.com/merchant?lang=ko#payment-links)에서 Base Sepolia 상품 수취 주소와 `fulfillment.requested`를 받을 전용 HTTPS 웹훅을 준비합니다. 같은 웹훅을 선택해 고정 가격 링크를 발급하세요. 구매 버튼 연결과 지갑 복구는 [결제 링크 가이드](https://0to1pay.com/guides/hosted-payment-links?lang=ko)에 있습니다.
3. 이 폴더에서 `npm ci`와 `cp .env.example .env`를 실행합니다. DB 주소, 가맹점 ID·프로젝트 ID와 `fulfillment:execute`, `fulfillment:results` 권한의 프로젝트 테스트 API 키를 입력하세요. 웹훅의 서명 키 ID와 base64url 서명 비밀은 각각 `WEBHOOK_KEY_ID`, `WEBHOOK_SECRET`에 넣습니다. `HOSTED_LINK_ID`에는 발급된 링크의 UUID를, `HOSTED_PRODUCT_REF`에는 대시보드의 상품 코드를 그대로 입력하세요. 이 값들은 서버 환경에 보관합니다.
4. `npm run migrate` 후 `npm run worker`를 시작합니다. 워커를 계속 실행해야 지급과 결과 보고가 진행됩니다. 구매 버튼에는 대시보드의 공개 구매 URL을 넣으세요.

### Next.js에서 연결

이 폴더를 기존 서버 프로젝트에 추가하고 의존성을 설치하거나 하위 패키지 그대로 사용하세요. 아래 `my-app/auth`의 두 함수는 가맹점의 기존 로그인·검증된 지갑 저장소에 연결할 부분입니다.

```js
// lib/hosted-pass.js
import 'server-only';
import { configureHostedPass, connectDatabase } from '../examples/hosted-access-pass/service.mjs';
import { currentMember, verifiedWalletForMember } from './my-app/auth';

export const hostedPass = configureHostedPass(connectDatabase(), async request => {
  const member = await currentMember(request);
  if (!member) return null;
  return verifiedWalletForMember(member.id); // {network_id: 'eip155:84532', address} 또는 null
});
```

```js
// app/api/webhooks/0to1pay/route.js — 이 HTTPS 주소를 전용 웹훅에 등록
import { hostedPass } from '@/lib/hosted-pass';
export const runtime = 'nodejs';
export const POST = hostedPass.webhook;
```

```js
// app/api/member-download/route.js — 보호할 파일을 내주는 경로에서 권한 확인
import { hostedPass } from '@/lib/hosted-pass';
import { openMemberDownload } from '@/lib/my-app/content';
export const runtime = 'nodejs';
export async function GET(request) {
  const access = await hostedPass.access(request);
  if (!access.ok) return access;
  return openMemberDownload(); // 보호할 파일을 private, no-store 캐시 정책으로 반환
}
```

가맹점은 현재 회원의 로그인과 지갑 소유권을 확인한 뒤 그 계정의 지갑을 반환해야 합니다. 예를 들어 로그인한 회원에게 가맹점 도메인·세션·네트워크·지갑·만료 시각을 담은 일회성 메시지에 서명하게 하고 서버에서 한 번만 소비하세요. 같은 지갑을 다른 계정에 중복 연결하지 않도록 저장합니다. 이 예제는 이 연결 정보를 가맹점 함수로 읽으며, 자체 로그인이나 라이선스 키를 발급하지 않습니다. 결제가 회원 연결보다 먼저 도착해도 원 지갑 소유를 확인하면 기존 이용권으로 접근할 수 있습니다. 인증된 지갑이 없으면 401, 다른 지갑이거나 활성 이용권이 없으면 403, 허가된 구매자는 200입니다. URL의 회원 ID·지갑 주소·주문 번호·거래 해시는 접근 권한이 될 수 없습니다.

### 지급과 재전달

웹훅은 원본 본문의 서명을 검증하고 테스트 프로젝트·링크·상품·Base Sepolia 결제 지갑을 확인합니다. HTTP 200은 SDK 수신함 저장을 뜻합니다. 워커는 실행 권한을 받은 뒤 이용권과 전송할 결과를 같은 DB 트랜잭션에 기록합니다. 재전달되거나 커밋 직후 워커를 재시작해도 주문별 지급은 한 건입니다. 예제 이용권에는 자동 만료일이 없습니다. 상품 만료·환불은 가맹점 정책입니다. 현재 호스팅 링크는 결제의 지급 자격이 사라지면 가맹점 검토 대상으로 남깁니다. 테스트의 명시적 버전별 회수·복구 명령은 자동 환불을 뜻하지 않습니다.

### 로컬 검증

테스트용 PostgreSQL에서 임시 스키마 생성·삭제 권한을 가진 계정을 사용합니다. 이 폴더에서 `npm ci` 후 `DATABASE_URL=postgresql://… npm test`를 실행하세요. 실제 SDK 서명·로컬 HTTP·PostgreSQL로 검증하고, 플랫폼의 실행 승인·결과 응답과 가맹점의 인증된 지갑 세션은 테스트용으로 제공합니다. 자금이나 지갑 연결은 필요 없습니다. [별도로 확인한 공개 테스트넷 구매 기록](../../docs/hosted-payment-link-receipt.md)
