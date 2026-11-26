import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AMOUNT, CHAIN, TOKEN, transferRecipient } from '../lib/transfer-receipt.mjs';

const payer = '0x'+'11'.repeat(20), recipient = '0x'+'22'.repeat(20), other = '0x'+'33'.repeat(20);
const transactionHash = '0x'+'44'.repeat(32), blockHash = '0x'+'55'.repeat(32), blockNumber='0x100';
const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const indexed = address=>'0x'+address.slice(2).padStart(64,'0');
const transfer = (to=recipient)=>({address:TOKEN,removed:false,transactionHash,blockHash,blockNumber,
  topics:[topic,indexed(payer),indexed(to)],data:'0x'+BigInt(AMOUNT).toString(16).padStart(64,'0')});

function fixture(logs=[transfer()]) {
  const receipt={transactionHash,blockHash,blockNumber,status:'0x1',type:'0x4',from:other,to:other,logs};
  const block={hash:blockHash,number:blockNumber,transactions:[transactionHash]};
  const source={chain:CHAIN,receipt,block};
  const methods=[];
  const wallet={request:async({method,params})=>{
    methods.push(method);
    if (method==='eth_chainId') return source.chain;
    if (method==='eth_getTransactionReceipt') { assert.deepEqual(params,[transactionHash]); return source.receipt; }
    assert.equal(method,'eth_getBlockByNumber');
    assert.deepEqual(params,[blockNumber,false]);
    return source.block;
  }};
  return {source,wallet,methods,read:(expected)=>transferRecipient(wallet,payer,transactionHash,expected)};
}

test('reads one canonical USDC transfer from the wallet or its relayer',async()=>{
  for (const relayed of [false,true]) {
    const f=fixture();
    if (!relayed) Object.assign(f.source.receipt,{from:payer,to:TOKEN,type:'0x2'});
    assert.equal(await f.read(recipient),recipient);
    assert.equal(await f.read(),recipient);
    assert.ok(f.methods.every(method=>['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(method)));
  }
});

test('an exact order can match inside a batch but bare-hash discovery requires one transfer',async()=>{
  const batch=fixture([transfer(other), transfer()]);
  assert.equal(await batch.read(recipient),recipient);
  await assert.rejects(batch.read(),/original order ID/);
  const duplicate=fixture([transfer(),transfer()]);
  await assert.rejects(duplicate.read(recipient),/multiple matching transfers to this order/);
  await assert.rejects(duplicate.read(),/original order ID/);
});

test('rejects incorrect sender, recipient, token, value, chain, receipt and removed or noncanonical logs',async()=>{
  const cases=[
    f=>{f.source.receipt.logs[0].topics[1]=indexed(other);},
    f=>{f.source.receipt.logs[0].topics[2]=indexed(other);},
    f=>{f.source.receipt.logs[0].address=other;},
    f=>{f.source.receipt.logs[0].data='0x'+'0'.repeat(63)+'1';},
    f=>{f.source.receipt.logs[0].topics[0]='0x'+'00'.repeat(32);},
    f=>{f.source.receipt.logs[0].topics[2]='0x'+'10'.repeat(12)+recipient.slice(2);},
    f=>{f.source.chain='0x1';},
    f=>{f.source.receipt.status='0x0';},
    f=>{f.source.receipt=null;},
    f=>{f.source.receipt.transactionHash=blockHash;},
    f=>{f.source.block.hash=transactionHash;},
    f=>{f.source.block.transactions=[];},
    f=>{f.source.receipt.logs[0].removed=true;},
    f=>{f.source.receipt.logs[0].blockHash=transactionHash;},
    f=>{f.source.receipt.logs[0].transactionHash=blockHash;},
    f=>{f.source.receipt.logs[0].blockNumber='0x99';},
  ];
  for (const change of cases) {
    const f=fixture(); change(f);
    await assert.rejects(f.read(recipient),/No matching confirmed Base Sepolia/);
  }
});
