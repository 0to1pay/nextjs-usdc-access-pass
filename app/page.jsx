import {cookies,headers} from 'next/headers';
import {checkoutLanguage} from './appearance.js';
import {cookieName,readOrder} from '../lib/checkout.mjs';
import PassCheckout from './checkout.jsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata({searchParams}) {
  return checkoutLanguage((await searchParams).lang, (await headers()).get('accept-language') || '') === 'ko'
    ? {title:'개발자 이용권 · 0to1pay',description:'Base Sepolia에서 0.01 테스트 USDC로 이용권을 구매하거나 기존 구매를 복구하세요.'}
    : {title:'Developer pass · 0to1pay',description:'Buy a pass for 0.01 test USDC on Base Sepolia or recover your existing purchase.'};
}

export default async function Page({searchParams}) {
  const [query,jar,requestHeaders] = await Promise.all([searchParams,cookies(),headers()]);
  const lang = checkoutLanguage(query.lang, requestHeaders.get('accept-language') || '');
  const token = jar.get(cookieName)?.value;
  const hasSession = Boolean(token && /^[\w-]{43}$/.test(token));
  // A returning buyer sees their own status in the first private HTML response.
  // New browsers obtain the HttpOnly guest cookie from the checkout GET route.
  const initialOrder = hasSession ? await readOrder(token).catch(() => null) : {entitled:false};
  return <PassCheckout lang={lang} initialOrder={initialOrder} initialNow={Date.now()} sessionReady={hasSession && initialOrder !== null}/>;
}
