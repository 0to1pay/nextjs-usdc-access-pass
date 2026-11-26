import { NextResponse } from 'next/server';
import { ZeroToOnePayError } from '@0to1pay/server-sdk';
import { CheckoutError, cookieName, mutate, newToken, readOrder } from '../../../lib/checkout.mjs';
import { required } from '../../../lib/merchant.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cookie = req => {
  const value = req.cookies.get(cookieName)?.value;
  return typeof value === 'string' && /^[\w-]{43}$/.test(value) ? value : null;
};
function json(data,status=200) { return NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}}); }
function withNewGuest(response) {
  response.cookies.set(cookieName,newToken(),{httpOnly:true,sameSite:'strict',secure:required('APP_ORIGIN').startsWith('https:'),
    path:process.env.NEXT_PUBLIC_BASE_PATH || '/',maxAge:60*60*24*30});
  return response;
}
export async function GET(req) {
  const token = cookie(req);
  const response = json(await readOrder(token));
  return token ? response : withNewGuest(response);
}
export async function POST(req) {
  if (req.headers.get('origin') !== required('APP_ORIGIN') || req.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return json({error:'SAME_ORIGIN_JSON_REQUIRED'},403);
  const token = cookie(req);
  if (!token) return json({error:'OPEN_CHECKOUT_FIRST'},401);
  if (Number(req.headers.get('content-length')) > 4096) return json({error:'BODY_TOO_LARGE'},413);
  let raw = '';
  for await (const chunk of req.body ?? []) {
    raw += Buffer.from(chunk).toString('utf8');
    if (raw.length > 4096) return json({error:'BODY_TOO_LARGE'},413);
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'INVALID_REQUEST'},400);
    const result = await mutate(token,body);
    return result.restart ? withNewGuest(json({entitled:false})) : json(result);
  } catch (err) {
    if (err instanceof SyntaxError) return json({error:'INVALID_JSON'},400);
    if (err instanceof CheckoutError) return json({error:err.message},err.status);
    if (err instanceof ZeroToOnePayError) return json({error:err.code},err.status);
    return json({error:'CHECKOUT_UNAVAILABLE'},503);
  }
}
