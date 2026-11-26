import { randomUUID, createHash } from 'node:crypto';
import { mkdir, link, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recipientProofMessage } from '@0to1pay/server-sdk';
import { api, directory, scope } from './merchant.mjs';

// Publish a complete private file atomically. Concurrent retries load the winner.
export async function persist(name, value) {
  const path = join(directory,name);
  const tmp = join(directory,'.' + randomUUID());
  await writeFile(tmp,value,{flag:'wx',mode:0o600});
  try {
    try { await link(tmp,path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return await readFile(path,'utf8');
  } finally { await unlink(tmp); }
}
export async function registerTestRecipient(cfg, ref) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const key = await persist('recipient-' + ref + '.key',generatePrivateKey());
  const signer = privateKeyToAccount(key);
  const proof = recipientProofMessage({...scope(),origin:cfg.origin,connection_id:cfg.connection_id,
    chain_id:84532,address:signer.address});
  const signature = await signer.signMessage({message:proof});
  await api().call('registerChainRecipients',{path:{connection_id:cfg.connection_id},
    idempotencyKey:'recipient:' + createHash('sha256').update(proof).digest('hex'),
    body:{recipients:[{address:signer.address,signature}]}});
  return signer.address;
}
