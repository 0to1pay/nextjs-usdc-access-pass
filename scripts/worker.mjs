import { setTimeout as delay } from 'node:timers/promises';
import { createWorker, db } from '../lib/merchant.mjs';
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
const worker = createWorker();
const once = process.argv.includes('--once');
try {
  do {
    const { command, receipt } = await worker.tick();
    if (!command && !receipt && !once) await delay(1000);
  } while (running && !once);
} finally { await db().end(); }
