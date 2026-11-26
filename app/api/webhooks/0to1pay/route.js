import { DeliveryError } from '@0to1pay/fulfillment-sdk';
import { inbox } from '../../../../lib/merchant.mjs';

export const runtime = 'nodejs';
export async function POST(request) {
  const limit = 1024 * 1024;
  if (Number(request.headers.get('content-length')) > limit) return new Response(null,{status:413});
  const chunks = [];
  let size = 0;
  if (!request.body) return new Response(null,{status:400});
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > limit) return new Response(null,{status:413});
    chunks.push(Buffer.from(chunk));
  }
  try {
    const received = await inbox().receive(Buffer.concat(chunks), Object.fromEntries(request.headers));
    return Response.json({received:true,duplicate:received.duplicate});
  } catch (err) {
    if (err instanceof DeliveryError) return Response.json({error:err.code},{status:err.status});
    return Response.json({error:'INBOX_UNAVAILABLE'},{status:503});
  }
}
