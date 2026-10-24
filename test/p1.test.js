import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { start } from '../server/index.js';
import { localReply, systemPrompt, BUTLER_ID } from '../server/personalities.js';
import { resetRateLimit } from '../server/auth.js';

const PASSWORD = 'correct-horse-battery';
const root = join(import.meta.dirname, '..');

async function boot(env = {}) {
  resetRateLimit();
  const dir = mkdtempSync(join(tmpdir(), 'valet-'));
  const app = await start({
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    dbFile: join(dir, 'valet.db'),
    staticRoot: root,
    env: { VALET_OWNER_PASSWORD: PASSWORD, VALET_SESSION_HOURS: '12', ...env },
  });
  return {
    app,
    dir,
    base: `http://127.0.0.1:${app.port}`,
    async stop() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function login(base, password = PASSWORD, personality) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, personality }),
  });
  const data = await res.json();
  return { res, data };
}

function talk(base, token, text) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/live');
    const frames = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 4000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      frames.push(msg);
      if (msg.type === 'ready') ws.send(JSON.stringify({ type: 'text', text }));
      if (msg.type === 'turn.complete' || msg.type === 'error') {
        clearTimeout(timer);
        ws.close();
        resolve(frames);
      }
    });
    ws.addEventListener('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

test('health names one butler and does not require a model', async () => {
  const ctx = await boot();
  try {
    const health = await (await fetch(`${ctx.base}/health`)).json();
    assert.equal(health.protocol, 1);
    assert.equal(health.auth, 'password');
    assert.equal(health.agent.id, BUTLER_ID);
    assert.equal(health.provider.name, 'local-butler');
    assert.equal(health.provider.capabilities.voice, false);
    const page = await fetch(`${ctx.base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="loginForm"/);
  } finally { await ctx.stop(); }
});

test('auth rejects a bad password and accepts the owner', async () => {
  const ctx = await boot();
  try {
    const bad = await login(ctx.base, 'not-the-owner-password');
    assert.equal(bad.res.status, 401);
    assert.equal(bad.data.token, undefined);
    const denied = await fetch(`${ctx.base}/api/messages`);
    assert.equal(denied.status, 401);
    const good = await login(ctx.base);
    assert.equal(good.res.status, 200);
    assert.equal(good.data.agent_id, BUTLER_ID);
    assert.ok(good.data.token);
    const session = await fetch(`${ctx.base}/api/session`, { headers: { Authorization: `Bearer ${good.data.token}` } });
    assert.equal(session.status, 200);
  } finally { await ctx.stop(); }
});

test('Bags replies in text and the history survives a new session', async () => {
  const ctx = await boot();
  try {
    const first = await login(ctx.base, PASSWORD, 'cynical');
    const frames = await talk(ctx.base, first.data.token, 'Please email the board the quarterly numbers');
    const text = frames.find((f) => f.type === 'text');
    assert.ok(text?.text);
    assert.match(text.text, /taken no further action|No action was taken|have not carried it out/i);
    assert.doesNotMatch(text.text, /I have (sent|emailed|called|completed|dispatched)/i);
    const done = frames.find((f) => f.type === 'turn.complete');
    assert.ok(done);
    const again = await login(ctx.base);
    const history = await (await fetch(`${ctx.base}/api/messages?agent=bags`, {
      headers: { Authorization: `Bearer ${again.data.token}` },
    })).json();
    assert.equal(history.agent_id, BUTLER_ID);
    assert.equal(history.messages.length, 2);
    assert.equal(history.messages[0].role, 'user');
    assert.match(history.messages[1].text, /quarterly numbers/);
    const recalled = await talk(ctx.base, again.data.token, 'What did I say earlier?');
    assert.match(recalled.find((f) => f.type === 'text').text, /quarterly numbers/);
  } finally { await ctx.stop(); }
});

test('personality does not change permissions', async () => {
  const ctx = await boot();
  try {
    const cynical = await login(ctx.base, PASSWORD, 'cynical');
    const precise = await login(ctx.base, PASSWORD, 'precise');
    assert.equal(cynical.data.personality, 'cynical');
    assert.equal(precise.data.personality, 'precise');
    const switched = await fetch(`${ctx.base}/api/settings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cynical.data.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personality: 'warm' }),
    });
    assert.equal((await switched.json()).permissions, 'unchanged');
    const noToken = await fetch(`${ctx.base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personality: 'warm' }),
    });
    assert.equal(noToken.status, 401);
    const agents = await (await fetch(`${ctx.base}/api/agents`, {
      headers: { Authorization: `Bearer ${precise.data.token}` },
    })).json();
    assert.equal(agents.agents.length, 1);
    assert.equal(agents.agents[0].id, BUTLER_ID);
    const other = await fetch(`${ctx.base}/api/agents/${encodeURIComponent('ceo1')}/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${precise.data.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(other.status, 409);
    assert.match(systemPrompt('warm'), /does not grant tools/i);
    assert.notEqual(localReply({ text: 'hello', personality: 'cynical', history: [] }), localReply({ text: 'hello', personality: 'precise', history: [] }));
  } finally { await ctx.stop(); }
});

test('approval flags are enforced on the server', async () => {
  const ctx = await boot();
  try {
    const { data } = await login(ctx.base);
    const headers = { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' };
    const meeting = await fetch(`${ctx.base}/api/meetings`, { method: 'POST', headers, body: JSON.stringify({ project: 'Notes', agenda: 'Talk', context_approved: false }) });
    assert.equal(meeting.status, 400);
    const task = await fetch(`${ctx.base}/api/tasks`, { method: 'POST', headers, body: JSON.stringify({ action: 'server_status', confirmed: false }) });
    assert.equal(task.status, 400);
    const ok = await fetch(`${ctx.base}/api/tasks`, { method: 'POST', headers, body: JSON.stringify({ action: 'server_status', confirmed: true }) });
    const body = await ok.json();
    assert.equal(ok.status, 202);
    assert.equal(body.result.connected, false);
    assert.equal(body.result.paperclip, 'not_linked');
  } finally { await ctx.stop(); }
});

test('a pairing code works once', async () => {
  const ctx = await boot();
  try {
    const { data } = await login(ctx.base);
    const minted = await (await fetch(`${ctx.base}/api/pair-codes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.token}` },
    })).json();
    assert.match(minted.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const paired = await fetch(`${ctx.base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.code.toLowerCase() }),
    });
    assert.equal(paired.status, 200);
    const again = await fetch(`${ctx.base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.code }),
    });
    assert.equal(again.status, 401);
  } finally { await ctx.stop(); }
});

test('locking the device erases history and sessions', async () => {
  const ctx = await boot();
  try {
    const { data } = await login(ctx.base);
    await talk(ctx.base, data.token, 'Remember the blue folder');
    const erased = await fetch(`${ctx.base}/api/device`, { method: 'DELETE', headers: { Authorization: `Bearer ${data.token}` } });
    assert.equal(erased.status, 200);
    const after = await fetch(`${ctx.base}/api/messages`, { headers: { Authorization: `Bearer ${data.token}` } });
    assert.equal(after.status, 401);
    const fresh = await login(ctx.base);
    const history = await (await fetch(`${ctx.base}/api/messages`, { headers: { Authorization: `Bearer ${fresh.data.token}` } })).json();
    assert.equal(history.messages.length, 0);
  } finally { await ctx.stop(); }
});

test('application source is not part of the public site', async () => {
  const ctx = await boot();
  try {
    for (const path of ['/server/index.js', '/test/p1.test.js', '/package.json', '/.env.example', '/data/valet.db']) {
      const res = await fetch(ctx.base + path);
      assert.equal(res.status, 404, path);
    }
    assert.equal((await fetch(`${ctx.base}/app.js`)).status, 200);
  } finally { await ctx.stop(); }
});

test('a failed model call is not replaced with a fake success', async () => {
  const ctx = await boot({ VALET_LLM_API_KEY: 'test-key', VALET_LLM_BASE_URL: 'http://127.0.0.1:9' });
  try {
    const { data } = await login(ctx.base);
    const frames = await talk(ctx.base, data.token, 'Hello');
    assert.equal(frames.find((f) => f.type === 'text'), undefined);
    assert.equal(frames.find((f) => f.type === 'error')?.error, 'provider_unavailable');
    const history = await (await fetch(`${ctx.base}/api/messages`, { headers: { Authorization: `Bearer ${data.token}` } })).json();
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].role, 'user');
  } finally { await ctx.stop(); }
});

test('an interrupt does not store an assistant reply', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  resetRateLimit();
  const dir = mkdtempSync(join(tmpdir(), 'valet-int-'));
  const app = await start({
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    dbFile: join(dir, 'valet.db'),
    staticRoot: root,
    env: { VALET_OWNER_PASSWORD: PASSWORD, VALET_LLM_API_KEY: 'test-key' },
    fetchImpl: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      gate.then(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'should not arrive' } }] }), { status: 200 })));
    }),
  });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const { data } = await login(base);
    const frames = await new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/live');
      const got = [];
      const timer = setTimeout(() => reject(new Error('timeout')), 4000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token: data.token })));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        got.push(msg);
        if (msg.type === 'ready') {
          ws.send(JSON.stringify({ type: 'text', text: 'Hold on' }));
          ws.send(JSON.stringify({ type: 'interrupt' }));
        }
        if (msg.type === 'error') {
          clearTimeout(timer);
          ws.close();
          resolve(got);
        }
      });
      ws.addEventListener('error', reject);
    });
    assert.equal(frames.at(-1).error, 'interrupted');
    const history = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${data.token}` } })).json();
    assert.equal(history.messages.some((m) => m.role === 'assistant'), false);
  } finally {
    release();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('static contract keeps the canonical butler id', () => {
  const vm = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import vm from 'node:vm';
    const agents = { window: {} };
    vm.runInNewContext(readFileSync('agents.js','utf8'), agents);
    if (agents.window.ORG.personal.id !== 'bagheera_butler.agent') process.exit(2);
    if (agents.window.ORG.personal.name !== 'Bags') process.exit(3);
    const ids = JSON.stringify(agents.window.ORG).match(/bagheera_butler\\.agent/g) || [];
    if (ids.length !== 1) process.exit(4);
    const orb = { window: {} };
    vm.runInNewContext(readFileSync('orb-state.js','utf8'), orb);
    const samples = [
      [{}, 'IDLE'],
      [{ listening: true }, 'LISTENING'],
      [{ speaking: true, listening: true }, 'SPEAKING'],
      [{ muted: true, listening: true }, 'MUTED'],
      [{ muted: true, processing: true }, 'MUTED'],
      [{ processing: true, speaking: true }, 'PROCESSING'],
      [{ error: true, processing: true }, 'ERROR'],
    ];
    for (const [input, expected] of samples) {
      if (orb.window.orbState(input) !== expected) process.exit(5);
    }
    if (orb.window.cycleAccent(3) !== 0) process.exit(6);
  `], { cwd: root, encoding: 'utf8' });
  assert.equal(vm.status, 0, vm.stderr);
});

test('production build succeeds', () => {
  const built = spawnSync(process.execPath, ['server/build.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /built /);
});
