# Hosted payment link receipt · 호스팅 결제 링크 검증

On November 26, 2026, the 0to1pay test merchant recorded **one Base Sepolia purchase, two verified webhook deliveries and one access pass for the paying wallet**. This was a public testnet purchase of 0.01 test USDC.

2026년 11월 26일, 0to1pay 테스트 가맹점은 공개 Base Sepolia 결제 링크에서 **0.01 테스트 USDC 구매 1건, 서명 웹훅 전달 2회, 원 구매 지갑 이용권 1개**를 확인했습니다.

| KST (UTC+9) | Event · 확인 항목 |
| --- | --- |
| 14:19:52.059 | Platform created the order · 플랫폼 주문 생성 |
| 14:22:40 | Base Sepolia block 63,743,460 included the transfer · 송금 블록 포함 |
| 14:40:54.464 | Platform recognized chain finality and requested fulfillment · 플랫폼 체인 확정 인식 및 지급 요청 |
| 14:40:55.549 | Test merchant verified the first webhook signature and returned HTTP success · 첫 웹훅 서명 검증 및 HTTP 성공 응답 |
| 14:41:21.061 | Merchant recorded one pass for the original payer and the platform accepted one fulfillment result · 원 구매 지갑 이용권 1개 기록 및 플랫폼 지급 결과 1개 수락 |

**Onchain receipt · 온체인 영수증.** The explorer shows one 10,000-unit USDC transfer from the paying wallet to the registered recipient. 탐색기에서 원 구매 지갑이 등록 수취인에게 USDC 10,000 원자 단위를 보낸 이벤트 한 건을 확인할 수 있습니다. [Base Sepolia transaction · 결제 거래](https://base-sepolia.blockscout.com/tx/0x0e758b0d0e22c8be6cfbcbcd302130b5d5e4330182100c2316d59ceaafbbd64b)

**Test merchant records.** An operator created the link through a project-scoped setup. A validation client signed the public checkout and transfer with the buyer’s test wallet. The merchant verified the raw webhook signature and stored the entitlement in SQLite. After the operator requested a replay, the merchant verified a second delivery of the same `fulfillment.requested` event and ran its handler again. The same stored entitlement and platform result were returned. The offchain counts come from the merchant receiver, entitlement database and platform result. Order creation to grant took **21 min 29.002 s**, including **26.597 s** from platform recognition of finality to the grant. That interval included a manual step to make the signed receiver snapshot available to the test worker.

**테스트 가맹점 기록.** 운영자가 해당 프로젝트에 한정된 권한으로 링크를 만들었고, 검증 클라이언트가 구매자의 실제 테스트 지갑으로 주문 증명과 송금에 서명했습니다. 가맹점은 수신한 웹훅 원문의 서명을 검증하고 SQLite에 이용권을 저장했습니다. 운영자가 재전송을 요청하자 같은 `fulfillment.requested` 이벤트가 두 번째로 전달됐습니다. 서명을 다시 검증하고 지급 핸들러를 재실행해도 기존 이용권과 같은 플랫폼 결과가 반환됐습니다. 오프체인 수치는 가맹점 수신 기록·이용권 DB·플랫폼 지급 결과에서 확인했습니다. 주문 생성부터 지급까지 **21분 29.002초**, 플랫폼의 확정 인식부터 지급까지 **26.597초**였습니다. 후자에는 검증 워커가 서명 수신 사본을 읽도록 운영자가 조치한 시간이 포함됐습니다.
