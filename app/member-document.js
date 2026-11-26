import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brandIcon, themeBootstrap } from './appearance.js';

const copy = {
  en: {
    membership: 'Developer pass', heading: 'Members’ edition', active: 'Your pass is active.',
    lesson: 'Reading a USDC payment', first: 'USDC on Base Sepolia uses six decimal places. A transfer of 10,000 atomic units appears in your wallet as 0.01 USDC.',
    second: 'Your wallet shows the network fee separately in test ETH. To see the token amount, recipient and fee for your own transfer, follow the transaction link in checkout.',
    locked: 'An active pass is required', recover: 'Already paid? Open checkout in the browser you used, or recover your purchase with the wallet that sent the USDC.',
    checkout: 'Back to checkout', guide: 'Open checkout', nav: 'Member navigation',
  },
  ko: {
    membership: '개발자 이용권', heading: '회원 콘텐츠', active: '이용권이 활성화됐습니다.',
    lesson: 'USDC 결제 금액 읽기', first: 'Base Sepolia의 USDC는 소수점 아래 여섯 자리까지 표시합니다. 거래에 최소 단위로 10,000이 기록되면 지갑에 표시되는 금액은 0.01 USDC입니다.',
    second: '지갑에는 네트워크 수수료가 테스트 ETH로 따로 표시됩니다. 내 거래의 금액과 수취 주소, 수수료는 결제 화면에서 내 거래 링크를 열어 확인할 수 있습니다.',
    locked: '활성 이용권이 필요합니다', recover: '이미 결제했다면 결제한 브라우저에서 주문을 여세요. 다른 브라우저를 사용 중이라면 USDC를 보낸 지갑으로 기존 구매를 복구할 수 있습니다.',
    checkout: '결제 화면으로 돌아가기', guide: '결제 화면 열기', nav: '회원 메뉴',
  },
};

let stylesheet;
async function memberStyles() {
  const assets = join(process.cwd(), 'app');
  const [css, fontFace, font] = await Promise.all([
    readFile(join(assets, 'checkout.css'), 'utf8'),
    readFile(join(assets, 'font.css'), 'utf8'),
    readFile(join(assets, 'fonts/dm-sans-latin.woff2')),
  ]);
  return fontFace.replace('./fonts/dm-sans-latin.woff2', 'data:font/woff2;base64,' + font.toString('base64')) + '\n' + css;
}

export async function memberDocument(korean, entitled) {
  const lang = korean ? 'ko' : 'en';
  const other = korean ? 'en' : 'ko';
  const t = copy[lang];
  const title = entitled ? t.heading : t.locked;
  const checkout = '../?lang=' + lang;
  stylesheet ??= await memberStyles();
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><link rel="icon" href="${brandIcon}"><title>${title} · 0to1pay</title>
<script>${themeBootstrap}</script><style>${stylesheet}</style></head>
<body>
<header class="site-header"><nav class="site-bar" aria-label="${t.nav}">
<a class="wordmark" href="https://0to1pay.com/?lang=${lang}" aria-label="0to1pay"><span class="wordmark-glyph" aria-hidden="true"></span>0to1pay</a>
<div class="site-links"><a lang="${other}" hreflang="${other}" href="?view=page&amp;lang=${other}">${korean ? 'English' : '한국어'}</a></div>
</nav></header>
<main id="content" class="checkout" tabindex="-1"><header class="summary">
<p class="network">${t.membership}</p><h1>${title}</h1>${entitled ? `<p>${t.active}</p>` : ''}</header>
<div class="panel">${entitled ? `<article><h2>${t.lesson}</h2><p>${t.first}</p><p>${t.second}</p></article>` : `<p>${t.recover}</p>`}
<a class="${entitled ? 'secondary' : 'primary'}" href="${checkout}">${entitled ? t.checkout : t.guide}</a></div></main></body></html>`;
}
