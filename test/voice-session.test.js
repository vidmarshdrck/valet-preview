import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);

function loadVoiceSession() {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('./voice-session.js', root), 'utf8'), context);
  return context.window;
}

test('a voice session moves through the real speech lifecycle', () => {
  const voice = loadVoiceSession();
  const session = voice.createVoiceSession();
  assert.equal(voice.voiceOrbState(session), 'IDLE');
  voice.beginVoiceSession(session);
  assert.equal(voice.voiceOrbState(session), 'PROCESSING');
  voice.noteMicrophoneOpen(session);
  assert.equal(voice.voiceOrbState(session), 'LISTENING');
  voice.captureSpokenLine(session, 'Good evening');
  assert.equal(voice.voiceOrbState(session), 'PROCESSING');
  assert.equal(session.transcript[0].source, 'speech');
  voice.beginSpeakingReply(session);
  assert.equal(voice.voiceOrbState(session), 'SPEAKING');
  voice.finishSpeakingReply(session);
  assert.equal(voice.voiceOrbState(session), 'LISTENING');
  assert.equal(session.active, true);
});

test('typing during voice keeps the session, the composer, and the transcript', () => {
  const voice = loadVoiceSession();
  const session = voice.createVoiceSession();
  voice.beginVoiceSession(session);
  voice.noteMicrophoneOpen(session);
  voice.rememberComposerText(session, 'The blue folder');
  voice.captureSpokenLine(session, 'Are you there');
  assert.equal(session.composerText, 'The blue folder');
  const typed = voice.acceptTypedMessage(session, session.composerText);
  assert.equal(typed.accepted, true);
  assert.equal(typed.sessionRemainsActive, true);
  assert.equal(session.active, true);
  assert.equal(voice.voiceOrbState(session), 'PROCESSING');
  assert.equal(session.transcript.map((line) => line.source).join(','), 'speech,typing');
  assert.equal(session.transcript[1].text, 'The blue folder');
  voice.beginSpeakingReply(session);
  voice.finishSpeakingReply(session);
  assert.equal(session.active, true);
  assert.equal(voice.voiceOrbState(session), 'LISTENING');
  assert.equal(session.transcript.length, 2);
});

test('mute and a microphone error are visible and do not invent a second session', () => {
  const voice = loadVoiceSession();
  const session = voice.createVoiceSession();
  voice.beginVoiceSession(session);
  voice.noteMicrophoneOpen(session);
  voice.captureSpokenLine(session, 'Hold on');
  voice.muteVoice(session);
  assert.equal(session.active, true);
  assert.equal(voice.voiceOrbState(session), 'MUTED');
  voice.unmuteVoice(session);
  assert.equal(voice.voiceOrbState(session), 'PROCESSING');
  voice.noteReplyFailed(session);
  assert.equal(voice.voiceOrbState(session), 'LISTENING');
  voice.noteVoiceError(session, 'Microphone permission denied');
  assert.equal(session.active, false);
  assert.equal(voice.voiceOrbState(session), 'ERROR');
  voice.endVoiceSession(session);
  assert.equal(voice.voiceOrbState(session), 'IDLE');
});

test('the phone page does not show draft, demo, sample, or placeholder labels', () => {
  const pages = ['index.html', 'agents.js', 'mock.js'];
  const banned = /\b(draft|demo|sample|placeholder)s?\b/i;
  for (const name of pages) {
    const raw = readFileSync(new URL(`./${name}`, root), 'utf8');
    const text = raw.replace(/\splaceholder="[^"]*"/g, '');
    assert.equal(banned.test(text), false, name);
  }
});

test('the phone header, Live control, and deploy files match this build', () => {
  const html = readFileSync(new URL('./index.html', root), 'utf8');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const panel = html.slice(html.indexOf('id="connPanel"'), html.indexOf('id="voiceOrb"'));
  assert.equal(header.includes('muteBtn') || header.includes('themeBtn'), false);
  assert.match(header, /id="connBtn"/);
  assert.match(panel, /id="muteBtn"/);
  assert.match(panel, /id="themeBtn"/);
  assert.match(panel, /id="personality"/);
  assert.match(panel, /id="lockBtn"/);
  assert.match(html, /id="liveLbl">Live</);
  assert.match(html, /<span>Chat<\/span>/);
  assert.equal(/<span>Talk<\/span>/.test(html), false);
  assert.match(html, /id="historyBtn"/);
  assert.match(html, /id="mCreate"[^>]*>Open meeting/);
  assert.equal(/id="mProject"|id="mOk"|id="tSpeak"/.test(html), false);
  assert.match(html, /id="composer" class="glass dock"/);
  const activities = html.match(/<button data-tab="act"[^>]*>/);
  assert.ok(activities);
  assert.equal(/class=/.test(activities[0]), false);
  const unit = readFileSync(new URL('./deploy/valet.service', root), 'utf8');
  const caddy = readFileSync(new URL('./deploy/Caddyfile', root), 'utf8');
  const nginx = readFileSync(new URL('./deploy/nginx-valet.conf', root), 'utf8');
  const docker = readFileSync(new URL('./Dockerfile', root), 'utf8');
  assert.match(unit, /VALET_DATA_DIR|EnvironmentFile/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8787/);
  assert.match(nginx, /proxy_set_header Upgrade/);
  assert.match(docker, /node:22/);
  const script = spawnSync('sh', ['-n', 'deploy/install.sh'], { cwd: root, encoding: 'utf8' });
  assert.equal(script.status, 0, script.stderr);
});

test('voice session script is part of the page and the production file list', () => {
  const html = readFileSync(new URL('./index.html', root), 'utf8');
  const build = readFileSync(new URL('./server/build.js', root), 'utf8');
  const worker = readFileSync(new URL('./sw.js', root), 'utf8');
  assert.match(html, /voice-session\.js/);
  assert.match(html, /data-state="IDLE"/);
  assert.match(build, /voice-session\.js/);
  assert.match(worker, /voice-session\.js/);
  const checked = spawnSync(process.execPath, ['--check', 'voice-session.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});
