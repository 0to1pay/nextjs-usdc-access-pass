import { cookieName, readOrder } from '../../../lib/checkout.mjs';
import { memberDocument } from '../../member-document.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const token = request.cookies.get(cookieName)?.value;
  const order = await readOrder(token && /^[\w-]{43}$/.test(token) ? token : null);
  const headers = {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store'};
  const params = new URL(request.url).searchParams;
  const ko = params.get('lang') === 'ko';
  headers['Content-Language'] = ko ? 'ko' : 'en';
  if (params.get('view') === 'page') {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    return new Response(await memberDocument(ko, order.entitled), {status:order.entitled ? 200 : 403, headers});
  }
  if (!order.entitled) return new Response(ko ? '활성 이용권이 필요합니다.' : 'An active pass is required.',{status:403,headers});
  return new Response((ko ? '회원 콘텐츠\n\nBase Sepolia 결제로 이 호를 열었습니다.\n주문 ' : 'Members’ edition\n\nYour Base Sepolia payment unlocked this issue.\nOrder ') + order.order_ref,{headers});
}
