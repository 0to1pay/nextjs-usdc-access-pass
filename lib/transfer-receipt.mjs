// Base Sepolia's six-decimal test USDC. Relay and wallet contract addresses vary.
export const CHAIN = '0x14a34';
export const TOKEN = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
export const AMOUNT = '10000';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const amountWord = '0x' + BigInt(AMOUNT).toString(16).padStart(64,'0');
const lookupError = 'No matching confirmed Base Sepolia USDC transfer. Check the wallet, hash and network, or wait for the receipt.';

export async function transferRecipient(wallet, payer, transactionHash, orderRecipient) {
  if (!hashPattern.test(transactionHash) || !addressPattern.test(payer) ||
      (orderRecipient !== undefined && !addressPattern.test(orderRecipient))) throw new Error(lookupError);
  const hash = transactionHash.toLowerCase();
  const chainId = () => wallet.request({method:'eth_chainId'});
  if (BigInt(await chainId()) !== BigInt(CHAIN)) throw new Error(lookupError);
  const receipt = await wallet.request({method:'eth_getTransactionReceipt',params:[hash]});
  if (receipt?.status !== '0x1' || receipt.transactionHash?.toLowerCase() !== hash ||
      !hashPattern.test(receipt.blockHash) || !quantityPattern.test(receipt.blockNumber) || !Array.isArray(receipt.logs)) {
    throw new Error(lookupError);
  }
  // Look up this height again to exclude an orphaned receipt. Platform processing
  // independently confirms the movement before issuing a fulfillment command.
  const block = await wallet.request({method:'eth_getBlockByNumber',params:[receipt.blockNumber,false]});
  const blockHash = receipt.blockHash.toLowerCase();
  if (block?.hash?.toLowerCase() !== blockHash || !quantityPattern.test(block.number) ||
      BigInt(block.number) !== BigInt(receipt.blockNumber) || !Array.isArray(block.transactions) ||
      !block.transactions.some(tx => typeof tx === 'string' && tx.toLowerCase() === hash) ||
      BigInt(await chainId()) !== BigInt(CHAIN)) throw new Error(lookupError);

  const senderTopic = '0x' + payer.slice(2).toLowerCase().padStart(64,'0');
  const expected = orderRecipient?.toLowerCase();
  const recipients = [];
  for (const log of receipt.logs) {
    if (log?.removed === true || log?.address?.toLowerCase() !== TOKEN || log.transactionHash?.toLowerCase() !== hash ||
        log.blockHash?.toLowerCase() !== blockHash || !quantityPattern.test(log.blockNumber) ||
        BigInt(log.blockNumber) !== BigInt(receipt.blockNumber) || !Array.isArray(log.topics) || log.topics.length !== 3 ||
        log.topics[0]?.toLowerCase() !== transferTopic || log.topics[1]?.toLowerCase() !== senderTopic ||
        log.data?.toLowerCase() !== amountWord) continue;
    const destination = /^0x0{24}([0-9a-f]{40})$/.exec(log.topics[2]?.toLowerCase() ?? '');
    if (!destination) continue;
    const recipient = '0x' + destination[1];
    if (recipient === payer.toLowerCase() || /^0x0{40}$/.test(recipient)) continue;
    if (!expected || recipient === expected) recipients.push(recipient);
  }
  if (recipients.length > 1) {
    throw new Error(expected ? 'This transaction has multiple matching transfers to this order. Contact the merchant with the order ID and hash.'
      : 'This transaction has multiple matching transfers. Recover with the original order ID or payment ID first.');
  }
  if (!recipients.length) throw new Error(lookupError);
  return recipients[0];
}
