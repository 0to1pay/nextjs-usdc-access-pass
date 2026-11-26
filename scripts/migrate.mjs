import { migrate, db } from '../lib/merchant.mjs';
try { await migrate(); } finally { await db().end(); }
