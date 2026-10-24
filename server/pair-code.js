import { resolve, join } from 'node:path';
import { openDb } from './store.js';
import { mintPairCode } from './auth.js';

const dataDir = resolve(process.env.VALET_DATA_DIR || join(process.cwd(), 'data'));
const db = openDb(process.env.VALET_DB || join(dataDir, 'valet.db'));
const minted = mintPairCode(db);
db.close();
console.log(minted.code);
console.error(`Expires ${new Date(minted.expiresAt).toISOString()} (single use).`);
