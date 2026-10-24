import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DEFAULT_PERSONALITY, normalizePersonality } from './personalities.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Owner password check. The hash lives in memory for this process;
 * the password itself is never stored or sent to the browser.
 */
export function ownerChecker(password) {
  const configured = typeof password === 'string' && password.trim().length >= 10 && password === password.trim();
  const salt = randomBytes(16);
  const key = scryptSync(configured ? password : randomBytes(32).toString('hex'), salt, 32, SCRYPT);
  return {
    configured,
    check(candidate) {
      const got = scryptSync(String(candidate ?? ''), salt, 32, SCRYPT);
      const equal = timingSafeEqual(got, key);
      return configured && equal;
    },
  };
}

const attempts = new Map();

export function rateLimit(ip, { limit = 8, windowMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const row = attempts.get(ip);
  if (!row || row.reset <= now) {
    attempts.set(ip, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  row.count += 1;
  if (row.count > limit) return { ok: false, remaining: 0, retryAt: row.reset };
  return { ok: true, remaining: limit - row.count };
}

export function resetRateLimit() {
  attempts.clear();
}

export function mintPairCode(db, { ttlMs = 5 * 60 * 1000, now = Date.now() } = {}) {
  const chars = [];
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  const code = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
  const expiresAt = now + ttlMs;
  db.prepare('INSERT INTO pair_codes (code_hash, expires_at, used) VALUES (?, ?, 0)').run(hashToken(code), expiresAt);
  return { code, expiresAt };
}

export function consumePairCode(db, code, now = Date.now()) {
  const hash = hashToken(String(code || '').trim().toUpperCase());
  const row = db.prepare('SELECT code_hash, expires_at, used FROM pair_codes WHERE code_hash = ?').get(hash);
  if (!row || row.used || row.expires_at < now) return false;
  db.prepare('UPDATE pair_codes SET used = 1 WHERE code_hash = ? AND used = 0').run(hash);
  return true;
}

export function createSession(db, { hours = 12, personality = DEFAULT_PERSONALITY, now = Date.now() } = {}) {
  const token = newToken();
  const expiresAt = now + hours * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, expires_at, personality, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), expiresAt, normalizePersonality(personality), now);
  return { token, expiresAt: Math.floor(expiresAt / 1000), personality: normalizePersonality(personality) };
}

export function readSession(db, token, now = Date.now()) {
  if (!token) return null;
  const row = db.prepare('SELECT token_hash, expires_at, personality FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!row || row.expires_at < now) return null;
  return { tokenHash: row.token_hash, expiresAt: Math.floor(row.expires_at / 1000), personality: normalizePersonality(row.personality) };
}

export function setPersonality(db, tokenHash, personality) {
  const p = normalizePersonality(personality);
  db.prepare('UPDATE sessions SET personality = ? WHERE token_hash = ?').run(p, tokenHash);
  return p;
}

export function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}
