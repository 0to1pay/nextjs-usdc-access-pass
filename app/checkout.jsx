'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AMOUNT, CHAIN, TOKEN, transferRecipient } from '../lib/transfer-receipt.mjs';

import { checkoutCopy } from './checkout-copy.js';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const lastOrderKey = '0to1pay:base-pass:last-order:' + BASE_PATH;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;

async function checkout(body) {
  const response = await fetch(BASE_PATH + '/api/checkout', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error?.code || 'Checkout is temporarily unavailable.');
  }
  return data;
}

async function connect() {
  const wallet = window.ethereum;
  if (!wallet?.request) throw new Error('Open this page in a browser with an Ethereum wallet.');
  let [payer] = await wallet.request({ method: 'eth_requestAccounts' });
  if (BigInt(await wallet.request({ method: 'eth_chainId' })) !== 84532n) {
    const selectBase = () => wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN}]});
    try { await selectBase(); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await wallet.request({method:'wallet_addEthereumChain',params:[{
        chainId:CHAIN,chainName:'Base Sepolia',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
        rpcUrls:['https://sepolia.base.org'],blockExplorerUrls:['https://sepolia.basescan.org'],
      }]});
      await selectBase();
    }
    [payer] = await wallet.request({method:'eth_accounts'});
  }
  if (!addressPattern.test(payer)) throw new Error('Select a wallet account.');
  return { wallet, payer: payer.toLowerCase() };
}

async function assertWallet(wallet, payer) {
  const [accounts,chain] = await Promise.all([
    wallet.request({method:'eth_accounts'}), wallet.request({method:'eth_chainId'}),
  ]);
  const [current] = accounts;
  if (current?.toLowerCase() !== payer.toLowerCase() || BigInt(chain) !== 84532n) {
    throw new Error('Select the original paying account on Base Sepolia and try again.');
  }
}

function assertTerms(order, payer, sending = false) {
  const recipient = order.recipient?.toLowerCase();
  if (order.network_id !== 'eip155:84532' || order.chain_id !== 84532 || !addressPattern.test(recipient) || /^0x0{40}$/.test(recipient) || recipient === payer ||
      order.token?.toLowerCase() !== TOKEN || order.amount_atomic !== AMOUNT ||
      order.payer_address?.toLowerCase() !== payer) throw new Error('Unexpected Base Sepolia USDC payment terms.');
  const prefix = '0to1pay: authorize checkout payment\n';
  if (!order.signing_message?.startsWith(prefix)) throw new Error('Missing checkout authorization.');
  const signed = JSON.parse(order.signing_message.slice(prefix.length));
  if (signed.environment !== 'test' || signed.chain_id !== 84532 || signed.network_id !== 'eip155:84532' ||
      signed.scale !== 6 || signed.amount_atomic !== AMOUNT || signed.token_address?.toLowerCase() !== TOKEN ||
      signed.recipient?.toLowerCase() !== recipient || signed.payer_address?.toLowerCase() !== payer ||
      signed.payment_id !== order.payment_id || signed.expires_at !== order.expires_at) {
    throw new Error('The authorization does not match this order.');
  }
  if (sending && !(Date.parse(order.expires_at) > Date.now())) throw new Error('The quote expired. Do not send funds.');
}

async function sign(wallet, payer, message) {
  await assertWallet(wallet, payer);
  const bytes = new TextEncoder().encode(message);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return wallet.request({ method: 'personal_sign', params: ['0x' + hex, payer] });
}

function storageKey(order) { return '0to1pay:base-sepolia:' + order.payment_id; }

async function prove(order, wallet, payer, hash) {
  assertTerms(order, payer);
  if (!hashPattern.test(hash)) throw new Error('Enter the full Base Sepolia transaction hash from the paying wallet.');
  const transaction_id = hash.toLowerCase();
  const claim = await checkout({ action:'claim-message', order_ref:order.order_ref, transaction_id });
  if (claim.signing_message !== order.signing_message + '\nTransaction: ' + transaction_id) {
    throw new Error('Unexpected transaction proof message.');
  }
  const signature = await sign(wallet, payer, claim.signing_message);
  return checkout({ action:'submit', order_ref:order.order_ref, transaction_id, signature });
}

function walletErrorCode(error) {
  for (const value of [error?.data?.originalError?.code, error?.cause?.code, error?.code]) {
    if (value != null && Number.isInteger(Number(value))) return Number(value);
  }
}

function errorText(error, t, operation) {
  const message = String(error?.message || '');
  if (walletErrorCode(error) === 4001 || /user (rejected|denied)|cancell?ed/i.test(message))
    return operation === 'proof' ? t.canceledProof : t.canceled;
  if (/No matching confirmed/.test(message)) return t.location;
  if (/multiple matching/.test(message)) return t.ambiguous;
  if (/browser with an Ethereum wallet/.test(message)) return t.noWallet;
  if (/original paying|Select a wallet|ORIGINAL_WALLET/.test(message)) return t.original;
  if (/MERCHANT_ORDER_REFERENCE|ENTER_ORDER_PAYMENT|FRESH_RECOVERY|OPEN_ORDER_FIRST/.test(message)) return t.missingOrder;
  if (/CHAIN_INTENT_SUBMISSION_CLOSED/.test(message)) return t.expiredProof;
  if (/TRANSFER_ALREADY_RESERVED|ORDER_CHANGED|RESERVATION_CHANGED|SUBMITTED_HASH_DIFFERS/.test(message)) return t.stale;
  if (/Unexpected|authorization|QUOTE_EXPIRED/.test(message)) return t.unsafe;
  return t.unavailable;
}

function Detail({label,value,t,onMessage,interactive}) {
  const textRef = useRef(null);
  if (!value) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(value); onMessage(t.copied); }
    catch {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(textRef.current); selection?.removeAllRanges(); selection?.addRange(range);
      onMessage(t.manualCopy);
    }
  }
  return <div className="detail"><dt>{label}</dt><dd><code ref={textRef}>{value}</code>
    <button className="copy" type="button" disabled={!interactive} onClick={copy} aria-label={t.copy + ' · ' + label}>{t.copy}</button></dd></div>;
}

export default function PassCheckout({lang:initialLang = 'en',initialOrder = null,initialNow = null,sessionReady = false}) {
  const [lang,setLang] = useState(initialLang);
  const [dark,setDark] = useState(false);
  const [interactive,setInteractive] = useState(false);
  const t = checkoutCopy[lang];
  const [order,setOrder] = useState(initialOrder);
  const [hash,setHash] = useState(initialOrder?.transaction_id || initialOrder?.broadcast_hint || '');
  const [reference,setReference] = useState('');
  const [restore,setRestore] = useState(false);
  const [notice,setNotice] = useState('');
  const [operation,setOperation] = useState('');
  const [reconnect,setReconnect] = useState(false);
  const [now,setNow] = useState(() => initialNow ?? Date.now());
  const initialized = useRef(sessionReady), initialRequest = useRef(null);
  const lock = useRef(false), revision = useRef(0), recent = useRef(null), heading = useRef(null), details = useRef(null);
  const langQuery = '?lang=' + lang;
  const hasOrder = Boolean(order?.payment_id);
  const pending = order?.submitted && !order.entitled && !order.revoked;
  const reserved = Boolean(order?.broadcast_reserved || order?.transaction_id);
  const deadline = order?.expires_at ? Date.parse(order.expires_at) + 86400000 : null;

  const update = useCallback(next => {
    revision.current++;
    setOrder(next);
    let known = next.transaction_id || next.broadcast_hint;
    try {
      if (next.payment_id) {
        localStorage.setItem(lastOrderKey,next.order_ref);
        known ||= localStorage.getItem(storageKey(next));
      }
    } catch { /* The original hash can also be pasted from wallet activity. */ }
    if (known) setHash(current => current || known);
    setNow(Date.now());
  },[]);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    const next = await checkout();
    initialized.current = true;
    if (request === revision.current) update(next);
  },[update]);

  const ensureSession = useCallback(() => {
    if (initialized.current) return;
    initialRequest.current ??= refresh().finally(() => { initialRequest.current = null; });
    return initialRequest.current;
  },[refresh]);

  useEffect(() => {
    const explicit = new URLSearchParams(location.search).get('lang');
    const colors = matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setDark((document.documentElement.dataset.theme || (colors.matches ? 'dark' : 'light')) === 'dark');
    try {
      if (explicit === 'ko' || explicit === 'en') localStorage.setItem('0to1pay.language', explicit);
    } catch { /* Browser storage is optional. */ }
    syncTheme();
    setInteractive(true);
    colors.addEventListener('change', syncTheme);
    return () => colors.removeEventListener('change', syncTheme);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = checkoutCopy[lang].title + ' · 0to1pay';
  }, [lang]);

  function changeLanguage(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const next = lang === 'en' ? 'ko' : 'en';
    const url = new URL(location.href);
    url.searchParams.set('lang', next);
    history.replaceState(history.state, '', url);
    try { localStorage.setItem('0to1pay.language', next); } catch { /* Private browsing. */ }
    setNotice('');
    setLang(next);
  }

  function changeTheme() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('0to1pay.theme', next); } catch { /* Private browsing. */ }
    setDark(next === 'dark');
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(lastOrderKey);
      if (saved) { setReference(saved); setRestore(true); }
    } catch { /* Optional local hint only. */ }
    if (initialOrder?.payment_id) update(initialOrder);
    Promise.resolve(ensureSession()).catch(() => setNotice(checkoutCopy[initialLang].refreshError));
  }, [initialLang,initialOrder,ensureSession,update]);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    let timer, stopped = false, inFlight = false;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState !== 'hidden')
        timer = setTimeout(tick, Date.now()-started < 15000 ? 1000 : Date.now()-started < 60000 ? 2500 : 6000);
    };
    async function tick() {
      if (stopped || document.visibilityState === 'hidden' || inFlight) return;
      inFlight = true;
      try { if (!lock.current) await refresh(); }
      catch { if (!stopped) setNotice(t.refreshError); }
      finally { inFlight = false; schedule(); }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') tick();
    };
    schedule();
    document.addEventListener('visibilitychange',visibility);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange',visibility); };
  },[pending,refresh,t]);

  useEffect(() => {
    if (!deadline || order?.submitted) return;
    const target = reserved ? deadline : Date.parse(order.expires_at);
    if (target <= Date.now()) { setNow(Date.now()); return; }
    const timer = setTimeout(() => setNow(Date.now()),target-Date.now()+1);
    return () => clearTimeout(timer);
  },[deadline,order?.expires_at,order?.submitted,reserved]);

  const stage = !order ? 'loading' : order.entitled ? 'granted' : order.revoked ? 'revoked' : reconnect ? 'reconnect' :
    !hasOrder ? (restore ? 'restore' : 'entry') : pending ? (order.fulfillment_received ? 'granting' : 'checking') :
    reserved ? (now >= deadline ? 'late' : 'proof') : now >= Date.parse(order.expires_at) ? 'expired' : order.authorized ? 'send' : 'authorize';
  const previousStage = useRef(stage);
  useEffect(() => {
    if (stage !== previousStage.current && previousStage.current !== 'loading') heading.current?.focus({preventScroll:true});
    previousStage.current = stage;
  },[stage]);

  async function run(name, task) {
    if (lock.current) return;
    lock.current = true; revision.current++;
    setNotice(''); setOperation(name);
    try {
      if (name !== 'refresh') await ensureSession();
      await task();
    }
    catch (error) {
      if (walletErrorCode(error) === 4100) setReconnect(true);
      else setNotice(errorText(error,t,name));
      try { await refresh(); } catch { /* Keep the original recovery instruction. */ }
    } finally { lock.current = false; setOperation(''); }
  }
  async function payerForOrder() {
    const account = await connect();
    if (order?.payer_address && account.payer !== order.payer_address.toLowerCase())
      throw new Error('Select the original paying account.');
    return account;
  }
  async function open() {
    const {payer} = await connect();
    update(await checkout({action:'open',payer_address:payer}));
  }
  async function authorize() {
    const {wallet,payer} = await payerForOrder();
    assertTerms(order,payer,true);
    const signature = await sign(wallet,payer,order.signing_message);
    update(await checkout({action:'authorize',order_ref:order.order_ref,signature}));
  }
  async function send() {
    const {wallet,payer} = await payerForOrder();
    assertTerms(order,payer,true);
    await assertWallet(wallet,payer);
    const data = '0xa9059cbb' + order.recipient.slice(2).toLowerCase().padStart(64,'0') + BigInt(AMOUNT).toString(16).padStart(64,'0');
    const {reservation_id} = await checkout({action:'reserve',order_ref:order.order_ref});
    update({...order,broadcast_reserved:true});
    let id;
    try {
      id = await wallet.request({method:'eth_sendTransaction',params:[{from:payer,to:TOKEN,chainId:CHAIN,value:'0x0',data}]});
    } catch (error) {
      // Only an explicit wallet rejection makes clearing the reservation safe.
      if (walletErrorCode(error) === 4001) update(await checkout({action:'release',order_ref:order.order_ref,reservation_id}));
      throw error;
    }
    if (!hashPattern.test(id)) throw new Error('Missing transaction hash');
    const sent = id.toLowerCase();
    recent.current = {order:order.order_ref,hash:sent};
    setHash(sent);
    try { localStorage.setItem(storageKey(order),sent); } catch { /* Server reservation survives reload. */ }
    update(await checkout({action:'remember-hash',order_ref:order.order_ref,reservation_id,transaction_id:sent}));
  }
  async function finishProof() {
    const {wallet,payer} = await payerForOrder();
    const id = hash.trim().toLowerCase();
    assertTerms(order,payer);
    // Only the hash returned to this tab by its validated transfer can skip receipt lookup.
    if (recent.current?.order !== order.order_ref || recent.current.hash !== id)
      await transferRecipient(wallet,payer,id,order.recipient);
    update(await prove(order,wallet,payer,id));
  }
  async function restoreBrowser() {
    const ref = reference.trim(), {wallet,payer} = await connect();
    const recipient = hashPattern.test(ref) ? await transferRecipient(wallet,payer,ref) : undefined;
    const {challenge,signing_message} = await checkout({action:'recovery-challenge',reference:ref,payer_address:payer,recipient});
    if (!signing_message.startsWith('Recover access to a 0to1pay demo purchase\nOrigin: ' + window.location.origin + '\n') ||
        !signing_message.includes('\nPaying wallet: ' + payer + '\n')) throw new Error('Unexpected recovery message.');
    const signature = await sign(wallet,payer,signing_message);
    const restored = await checkout({action:'recover-session',challenge,signature});
    if (restored.order_ref !== challenge.order_ref) throw new Error('ORDER_CHANGED');
    if (hashPattern.test(ref)) setHash(ref);
    update(restored);
  }
  async function reconnectWallet() {
    const wallet = window.ethereum;
    if (!wallet?.request) throw new Error('Open this page in a browser with an Ethereum wallet.');
    try { await wallet.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]}); }
    catch (error) {
      if (![4200,-32601].includes(walletErrorCode(error))) throw error;
      setNotice(t.reconnectHelp);
      return;
    }
    await payerForOrder();
    setReconnect(false); setNotice(t.connected);
  }
  async function restart() {
    const next = await checkout({action:'restart',order_ref:order.order_ref});
    try { localStorage.removeItem(lastOrderKey); } catch { /* Optional hint. */ }
    recent.current = null; setHash(''); setReference(''); setRestore(false); update(next);
  }

  const title = {loading:t.starting,entry:t.entry,restore:t.restoreTitle,authorize:t.authTitle,send:t.sendTitle,proof:t.proofTitle,
    late:t.proofTitle,checking:t.checking,granting:t.granting,granted:t.granted,revoked:t.revoked,expired:t.expired,reconnect:t.reconnectTitle}[stage];
  const help = {entry:t.entryNote,restore:t.restoreNote,authorize:t.authNote,send:t.sendNote,proof:t.proofNote,late:t.late,
    checking:t.checkingNote,granting:t.grantingNote,granted:t.grantedNote,revoked:t.revokedNote,expired:t.expiredNote,reconnect:t.reconnectNote}[stage];
  const tx = order?.transaction_id || order?.broadcast_hint || hash.trim();
  const busy = !interactive || Boolean(operation);
  const button = (label,action,name,disabled=false) => <button type="button" className="primary" disabled={busy||disabled}
    onClick={() => run(name,action)}>{label}</button>;
  const changeMode = value => { setRestore(value); setNotice(''); };
  return <div lang={lang}>
    <header className="site-header"><nav className="site-bar" aria-label={t.nav}>
      <a className="wordmark" href={'https://0to1pay.com/'+langQuery}><span className="wordmark-glyph" aria-hidden="true"/>0to1pay</a>
      <div className="site-links">
        <a href={'https://0to1pay.com/docs'+langQuery+'#nextjs-quickstart'}>{t.docs}</a>
        <a lang={lang==='en'?'ko':'en'} title={t.switchLanguage} onClick={changeLanguage}
          href={(BASE_PATH || '/')+'?lang='+(lang==='en'?'ko':'en')}>{t.language}</a>
        <button className="theme-toggle" type="button" disabled={!interactive} onClick={changeTheme} aria-label={dark?t.lightMode:t.darkMode}
          title={dark?t.lightMode:t.darkMode}><span aria-hidden="true">{dark?'☼':'◐'}</span></button>
      </div>
    </nav></header>
    <main className="checkout">
    <header className="summary"><p className="network">{t.network}</p><h1>{t.title}</h1><p className="price">{t.price}</p><p>{t.gas}</p></header>
    <div className="checkout-actions">
    {stage !== 'granted' && <noscript><p className="panel">{t.enableJs}</p></noscript>}
    <section className="panel" aria-labelledby="stage">
      <h2 id="stage" tabIndex="-1" ref={heading}>{title}</h2>{help && <p>{help}</p>}
      {stage === 'entry' && <><button className="secondary recovery" type="button" disabled={busy} onClick={() => changeMode(true)}>{t.already}</button>{button(t.open,open,'open')}</>}
      {stage === 'restore' && <><form onSubmit={e => {e.preventDefault(); run('restore',restoreBrowser);}}>
        <label htmlFor="reference">{t.reference}</label><input id="reference" value={reference} autoComplete="off" spellCheck={false}
          onChange={e => setReference(e.target.value)} required /><p className="hint">{t.refHelp}</p>
        <button className="primary" disabled={busy||!reference.trim()}>{t.restore}</button></form>
        <button className="secondary" type="button" disabled={busy} onClick={() => changeMode(false)}>{t.fresh}</button></>}
      {stage === 'authorize' && <><dl><Detail label={t.recipient} value={order.recipient} t={t} interactive={interactive} onMessage={setNotice}/></dl>{button(t.authorize,authorize,'authorize')}</>}
      {stage === 'send' && <><dl><Detail label={t.recipient} value={order.recipient} t={t} interactive={interactive} onMessage={setNotice}/></dl>{button(t.send,send,'send')}</>}
      {stage === 'proof' && <form onSubmit={e => {e.preventDefault();run('proof',finishProof);}}>
        <label htmlFor="hash">{t.txHash}</label><input id="hash" value={hash} autoComplete="off" spellCheck={false} placeholder={t.paste}
          onChange={e => setHash(e.target.value)} required/><p className="hint">{t.deadline} <time dateTime={new Date(deadline).toISOString()}>{new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(deadline)} UTC</time></p>
        <button className="primary" disabled={busy||!hashPattern.test(hash.trim())}>{t.proof}</button></form>}
      {['checking','granting'].includes(stage) && <><p>{t.waiting}</p>{button(t.refresh,refresh,'refresh')}</>}
      {stage === 'granted' && <a className="primary" href={BASE_PATH+'/api/pass'+langQuery+'&view=page'}>{t.read}</a>}
      {['late','revoked'].includes(stage) && <button type="button" className="primary" disabled={!interactive} onClick={() => {
        if (details.current) { details.current.open = true; details.current.querySelector('summary')?.focus(); }
      }}>{t.showDetails}</button>}
      {stage === 'expired' && button(t.restart,restart,'restart')}
      {stage === 'reconnect' && <><p>{t.reconnectHelp}</p>{button(t.reconnect,reconnectWallet,'reconnect')}</>}
      {stage === 'loading' && notice && button(t.retry,refresh,'refresh')}
      <p className="status" role="status" aria-live="polite">{operation ? (['refresh','open'].includes(operation)?t.starting:t.checkingWallet) : notice}</p>
    </section>
    {hasOrder && <details ref={details} className="details"><summary>{t.support}</summary><dl>
      <Detail label={t.order} value={order.order_ref} t={t} interactive={interactive} onMessage={setNotice}/><Detail label={t.payment} value={order.payment_id} t={t} interactive={interactive} onMessage={setNotice}/>
      {!['authorize','send'].includes(stage) && <Detail label={t.recipient} value={order.recipient} t={t} interactive={interactive} onMessage={setNotice}/>}
      {hashPattern.test(tx) && <Detail label={t.txHash} value={tx} t={t} interactive={interactive} onMessage={setNotice}/>}</dl></details>}
    {hasOrder && hashPattern.test(tx) && <footer><a href={'https://sepolia.basescan.org/tx/'+tx.toLowerCase()} target="_blank" rel="noopener noreferrer">{t.explorer}</a></footer>}
    </div></main>
  </div>;
}
