import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, mkdirSync, createReadStream, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { openDb, wipeOwnerData } from './store.js';
import {
  bearer, consumePairCode, createSession, mintPairCode, ownerChecker,
  rateLimit, readSession, resetRateLimit, setPersonality,
} from './auth.js';
import { clipText, completeTurn, providerStatus } from './chat.js';
import { BUTLER_ID, BUTLER_NAME, DEFAULT_PERSONALITY, normalizePersonality } from './personalities.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_LIMIT = 1024 * 256;
const UPLOAD_LIMIT = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'text/plain', 'application/pdf']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function canonicalAgent(id) {
  if (!id || id === 'bags' || id === BUTLER_ID) return BUTLER_ID;
  return String(id);
}

function butlerRecord() {
  return { id: BUTLER_ID, name: BUTLER_NAME, role: 'Personal butler', route: 'owner', live: true };
}

function send(res, status, body, headers = {}) {
  const json = body !== null && typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = json ? JSON.stringify(body) : (body ?? '');
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; worker-src 'self'; font-src 'self'",
    ...(json ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(Object.assign(new Error('too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, JSON_LIMIT);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function sessionHours(env) {
  const n = Number(env.VALET_SESSION_HOURS || 12);
  return Number.isFinite(n) && n > 0 && n <= 24 * 14 ? n : 12;
}

function requireSession(db, req, res) {
  const token = bearer(req);
  const session = readSession(db, token);
  if (!session) {
    send(res, 401, { error: 'unauthorized' });
    return null;
  }
  return session;
}

function listMessages(db, agentId) {
  const rows = db.prepare(
    'SELECT role, text, personality, created_at FROM messages WHERE agent_id = ? ORDER BY id DESC LIMIT 200',
  ).all(agentId).reverse();
  return rows.map((r) => ({ role: r.role, text: r.text, personality: r.personality, created_at: r.created_at }));
}

function addMessage(db, { agentId, role, text, personality }) {
  const created = Date.now();
  db.prepare('INSERT INTO messages (agent_id, role, text, personality, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(agentId, role, text, normalizePersonality(personality), created);
}

function addEvent(db, type, payload) {
  db.prepare('INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)').run(type, JSON.stringify(payload), Date.now());
}

function meetingView(db, row) {
  const entries = db.prepare('SELECT kind, text, speaker, source, owner_agent_id, deadline FROM meeting_entries WHERE meeting_id = ? ORDER BY id').all(row.id);
  return {
    id: row.id,
    project: row.project,
    agenda: row.agenda,
    participants: JSON.parse(row.participants),
    state: row.state,
    runtime: 'disconnected',
    active_speaker: 'user',
    automatic_turns: false,
    entries,
  };
}

const STATIC_EXT = new Set(['.html', '.js', '.css', '.webmanifest', '.png', '.ttf', '.svg', '.txt']);
const STATIC_BLOCK = /^(server|test|node_modules|data|dist)(\/|$)/;

function safeStatic(root, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.includes('\0')) return null;
  if (rel === '/') rel = '/index.html';
  rel = rel.replace(/^\/+/, '');
  if (!rel || STATIC_BLOCK.test(rel) || rel.split('/').some((part) => part.startsWith('.'))) return null;
  if (!STATIC_EXT.has(extname(rel).toLowerCase())) return null;
  const base = resolve(root);
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export function createApp(options = {}) {
  const env = options.env || process.env;
  const staticRoot = resolve(options.staticRoot || env.VALET_STATIC_ROOT || join(HERE, '..'));
  const dataDir = resolve(options.dataDir || env.VALET_DATA_DIR || join(process.cwd(), 'data'));
  const db = options.db || openDb(options.dbFile || join(dataDir, 'valet.db'));
  const uploads = join(dataDir, 'uploads');
  const owner = options.owner || ownerChecker(env.VALET_OWNER_PASSWORD || '');

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') {
        send(res, 200, {
          protocol: 1,
          auth: owner.configured ? 'password' : 'unconfigured',
          provider: providerStatus(env),
          agent: { id: BUTLER_ID, name: BUTLER_NAME },
        });
        return;
      }
      if (req.method === 'POST' && path === '/api/login') {
        const ip = req.socket.remoteAddress || 'local';
        const gate = rateLimit(ip);
        if (!gate.ok) return send(res, 429, { error: 'rate_limited' });
        if (!owner.configured) return send(res, 503, { error: 'auth_not_configured' });
        const body = await readJson(req);
        if (!owner.check(body.password)) return send(res, 401, { error: 'invalid_password' });
        const session = createSession(db, { hours: sessionHours(env), personality: body.personality });
        return send(res, 200, { token: session.token, expires_at: session.expiresAt, personality: session.personality, agent_id: BUTLER_ID });
      }
      if (req.method === 'POST' && path === '/api/pair') {
        const ip = req.socket.remoteAddress || 'local';
        const gate = rateLimit(ip);
        if (!gate.ok) return send(res, 429, { error: 'rate_limited' });
        const body = await readJson(req);
        if (!consumePairCode(db, body.code)) return send(res, 401, { error: 'invalid_code' });
        const session = createSession(db, { hours: sessionHours(env) });
        return send(res, 200, { token: session.token, expires_at: session.expiresAt, personality: session.personality, agent_id: BUTLER_ID });
      }

      if (path.startsWith('/api/')) {
        const session = requireSession(db, req, res);
        if (!session) return;
        if (req.method === 'GET' && path === '/api/session') {
          return send(res, 200, {
            expires_at: session.expiresAt,
            personality: session.personality,
            provider: providerStatus(env),
            agent: butlerRecord(),
          });
        }
        if (req.method === 'POST' && path === '/api/settings') {
          const body = await readJson(req);
          if (!['cynical', 'precise', 'warm'].includes(String(body.personality || '').toLowerCase())) {
            return send(res, 400, { error: 'invalid_personality' });
          }
          const personality = setPersonality(db, session.tokenHash, body.personality);
          return send(res, 200, { personality, permissions: 'unchanged' });
        }
        if (req.method === 'POST' && path === '/api/pair-codes') {
          const minted = mintPairCode(db);
          return send(res, 201, { code: minted.code, expires_at: Math.floor(minted.expiresAt / 1000) });
        }
        if (req.method === 'GET' && path === '/api/agents') {
          return send(res, 200, { agents: [butlerRecord()] });
        }
        const agentSession = /^\/api\/agents\/([^/]+)\/session$/.exec(path);
        if (req.method === 'POST' && agentSession) {
          const id = canonicalAgent(decodeURIComponent(agentSession[1]));
          if (id !== BUTLER_ID) return send(res, 409, { error: 'agent_disconnected' });
          const token = bearer(req);
          return send(res, 200, { token, agent_id: BUTLER_ID });
        }
        if (req.method === 'GET' && path === '/api/messages') {
          const agent = canonicalAgent(url.searchParams.get('agent'));
          if (agent !== BUTLER_ID) return send(res, 404, { error: 'unknown_agent' });
          return send(res, 200, { messages: listMessages(db, BUTLER_ID), agent_id: BUTLER_ID });
        }
        if (req.method === 'DELETE' && path === '/api/device') {
          wipeOwnerData(db);
          return send(res, 200, { erased: true });
        }
        if (req.method === 'POST' && path === '/api/uploads') {
          if (String(req.headers['x-upload-consent'] || '') !== 'yes') return send(res, 400, { error: 'consent_required' });
          const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (!ALLOWED_MIME.has(mime)) return send(res, 415, { error: 'attachment_not_supported' });
          const buf = await readBody(req, UPLOAD_LIMIT);
          mkdirSync(uploads, { recursive: true });
          const id = randomBytes(16).toString('hex');
          writeFileSync(join(uploads, id), buf);
          return send(res, 201, { id, stored: true, analysed: false });
        }
        if (path === '/api/tasks' && req.method === 'GET') {
          const tasks = db.prepare('SELECT id, action, status, result FROM tasks ORDER BY created_at').all()
            .map((t) => ({ ...t, result: JSON.parse(t.result) }));
          return send(res, 200, { tasks });
        }
        if (path === '/api/tasks' && req.method === 'POST') {
          const body = await readJson(req);
          if (body.confirmed !== true) return send(res, 400, { error: 'confirmed required' });
          if (body.action !== 'server_status') return send(res, 400, { error: 'unsupported_action' });
          const id = randomBytes(8).toString('hex');
          const result = {
            connected: false,
            paperclip: 'not_linked',
            pms: 'not_linked',
            detail: 'No upstream services are connected to this Valet server.',
          };
          db.prepare('INSERT INTO tasks (id, action, status, result, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, 'server_status', 'completed', JSON.stringify(result), Date.now());
          addEvent(db, 'task.completed', { task_id: id, speech: 'Status check finished. No upstream services are connected.' });
          return send(res, 202, { id, action: 'server_status', status: 'completed', result });
        }
        if (path === '/api/events' && req.method === 'GET') {
          const after = Number(url.searchParams.get('after') || 0);
          const events = db.prepare('SELECT seq, type, payload FROM events WHERE seq > ? ORDER BY seq').all(Number.isFinite(after) ? after : 0)
            .map((e) => ({ seq: e.seq, type: e.type, ...JSON.parse(e.payload) }));
          const next = events.length ? events[events.length - 1].seq : (Number.isFinite(after) ? after : 0);
          return send(res, 200, { events, next_cursor: next });
        }
        if (path === '/api/meetings' && req.method === 'GET') {
          const meetings = db.prepare('SELECT * FROM meetings ORDER BY created_at').all().map((m) => meetingView(db, m));
          return send(res, 200, { meetings });
        }
        if (path === '/api/meetings' && req.method === 'POST') {
          const body = await readJson(req);
          if (body.context_approved !== true) return send(res, 400, { error: 'context_approved required' });
          const project = clipText(body.project || '').trim();
          const agenda = clipText(body.agenda || '').trim();
          if (!project || !agenda) return send(res, 400, { error: 'project_and_agenda_required' });
          const participants = [...new Set([BUTLER_ID, ...(Array.isArray(body.participants) ? body.participants.map(canonicalAgent) : [])])].slice(0, 8);
          const id = randomBytes(8).toString('hex');
          db.prepare('INSERT INTO meetings (id, project, agenda, participants, state, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, project, agenda, JSON.stringify(participants), 'manual_context_only', Date.now());
          return send(res, 201, meetingView(db, db.prepare('SELECT * FROM meetings WHERE id = ?').get(id)));
        }
        const meetingId = /^\/api\/meetings\/([^/]+)$/.exec(path);
        if (meetingId && req.method === 'GET') {
          const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId[1]);
          if (!row) return send(res, 404, { error: 'not_found' });
          return send(res, 200, meetingView(db, row));
        }
        if (meetingId && req.method === 'DELETE') {
          db.prepare('DELETE FROM meeting_entries WHERE meeting_id = ?').run(meetingId[1]);
          db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId[1]);
          return send(res, 200, {});
        }
        const minutes = /^\/api\/meetings\/([^/]+)\/minutes$/.exec(path);
        if (minutes && req.method === 'GET') {
          const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(minutes[1]);
          if (!row) return send(res, 404, { error: 'not_found' });
          const view = meetingView(db, row);
          const lines = [`# ${view.project}`, '', `Agenda: ${view.agenda}`, '', 'No external agents attended. Entries below were recorded by the owner.', ''];
          for (const e of view.entries) lines.push(`- [${e.kind}] ${e.text} (recorded by user)`);
          return send(res, 200, lines.join('\n'), { 'Content-Type': 'text/markdown; charset=utf-8' });
        }
        const entries = /^\/api\/meetings\/([^/]+)\/entries$/.exec(path);
        if (entries && req.method === 'POST') {
          const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(entries[1]);
          if (!row) return send(res, 404, { error: 'not_found' });
          const body = await readJson(req);
          if (body.confirmed !== true) return send(res, 400, { error: 'confirmed required' });
          const text = clipText(body.text).trim();
          if (!text) return send(res, 400, { error: 'invalid_entry' });
          const kind = ['note', 'decision', 'action_item'].includes(body.kind) ? body.kind : 'note';
          db.prepare('INSERT INTO meeting_entries (meeting_id, kind, text, speaker, source, owner_agent_id, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(entries[1], kind, text, 'user', 'user_recorded', body.owner_agent_id || null, body.deadline || null, Date.now());
          return send(res, 201, { kind, text, speaker: 'user', source: 'user_recorded' });
        }
        const turn = /^\/api\/meetings\/([^/]+)\/turn$/.exec(path);
        if (turn && req.method === 'POST') {
          const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(turn[1]);
          if (!row) return send(res, 404, { error: 'not_found' });
          const body = await readJson(req);
          if (body.confirmed !== true) return send(res, 400, { error: 'confirmed required' });
          if (body.speaker_id !== 'user') return send(res, 409, { error: 'meeting_runtime_disconnected' });
          return send(res, 200, meetingView(db, row));
        }
        return send(res, 404, { error: 'no_route' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
      const file = safeStatic(staticRoot, path);
      if (!file || !existsSync(file)) return send(res, 404, { error: 'not_found' });
      const st = statSync(file);
      if (!st.isFile()) return send(res, 404, { error: 'not_found' });
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; worker-src 'self'; font-src 'self'",
        'Content-Length': st.size,
        'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('request failed');
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'server_error' : err.message });
    }
  }

  const tlsKey = env.VALET_TLS_KEY;
  const tlsCert = env.VALET_TLS_CERT;
  const server = tlsKey && tlsCert
    ? https.createServer({ key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }, handle)
    : http.createServer(handle);

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (socket) => {
    let token = '';
    let inflight = null;
    socket.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!token) {
        if (msg.type !== 'auth') return socket.close(4401, 'unauthorized');
        const authed = readSession(db, msg.token);
        if (!authed) return socket.close(4401, 'unauthorized');
        token = msg.token;
        socket.send(JSON.stringify({ type: 'ready', provider: providerStatus(env), agent_id: BUTLER_ID }));
        return;
      }
      if (msg.type === 'ping') return;
      if (msg.type === 'interrupt') {
        inflight?.abort();
        return;
      }
      if (msg.type !== 'text') return;
      if (inflight) {
        socket.send(JSON.stringify({ type: 'error', error: 'turn_busy' }));
        return;
      }
      const text = clipText(msg.text);
      if (!text) return;
      const live = readSession(db, token);
      if (!live) return socket.close(4401, 'unauthorized');
      const personality = live.personality || DEFAULT_PERSONALITY;
      addMessage(db, { agentId: BUTLER_ID, role: 'user', text, personality });
      const history = listMessages(db, BUTLER_ID).slice(0, -1);
      const controller = new AbortController();
      inflight = controller;
      let result;
      try {
        result = await completeTurn({
          text,
          personality,
          history,
          env,
          fetchImpl: options.fetchImpl,
          signal: controller.signal,
        });
      } finally {
        inflight = null;
      }
      if (socket.readyState !== 1) return;
      if (result.error) {
        socket.send(JSON.stringify({ type: 'error', error: result.error }));
        return;
      }
      addMessage(db, { agentId: BUTLER_ID, role: 'assistant', text: result.text, personality });
      socket.send(JSON.stringify({ type: 'text', text: result.text }));
      socket.send(JSON.stringify({ type: 'turn.complete' }));
    });
  });

  return {
    server,
    wss,
    db,
    staticRoot,
    dataDir,
    owner,
    close: async () => {
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* already gone */ }
      }
      await new Promise((resolveClose) => wss.close(() => resolveClose()));
      if (server.listening) await new Promise((resolveClose) => server.close(() => resolveClose()));
      try { db.close(); } catch { /* already closed */ }
    },
  };
}

export function start(options = {}) {
  resetRateLimit();
  const env = options.env || process.env;
  const app = createApp(options);
  const host = options.host || env.VALET_HOST || '0.0.0.0';
  const port = Number(options.port ?? env.VALET_PORT ?? 8787);
  return new Promise((resolveListen, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, () => {
      const addr = app.server.address();
      app.port = typeof addr === 'object' ? addr.port : port;
      app.host = host;
      resolveListen(app);
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start().then((app) => {
    const tls = process.env.VALET_TLS_KEY && process.env.VALET_TLS_CERT;
    console.log(`Valet listening on ${tls ? 'https' : 'http'}://${app.host}:${app.port}`);
    console.log(`Auth: ${app.owner.configured ? 'owner password configured' : 'NOT CONFIGURED — set VALET_OWNER_PASSWORD (10+ characters)'}`);
    console.log(`Text provider: ${providerStatus(process.env).name}`);
    console.log(`Butler: ${BUTLER_ID}`);
  }).catch((err) => {
    console.error(err.message || 'failed to start');
    process.exit(1);
  });
}
