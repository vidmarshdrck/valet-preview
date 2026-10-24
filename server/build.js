import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const files = [
  'index.html', 'app.css', 'app.js', 'agents.js', 'mock.js', 'orb-state.js', 'voice-session.js',
  'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', '.nojekyll',
];
const checks = [
  'app.js', 'agents.js', 'mock.js', 'orb-state.js', 'voice-session.js', 'sw.js',
  'server/index.js', 'server/auth.js', 'server/chat.js', 'server/store.js',
  'server/personalities.js', 'server/pair-code.js', 'server/build.js',
];

for (const file of checks) {
  const res = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(res.stderr || `syntax check failed: ${file}`);
    process.exit(1);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'server'), { recursive: true });
await mkdir(join(dist, 'fonts'), { recursive: true });
for (const file of files) {
  try {
    await access(join(root, file));
  } catch {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  await cp(join(root, file), join(dist, file));
}
await cp(join(root, 'fonts'), join(dist, 'fonts'), { recursive: true });
for (const file of ['index.js', 'auth.js', 'chat.js', 'store.js', 'personalities.js', 'pair-code.js']) {
  await cp(join(root, 'server', file), join(dist, 'server', file));
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(dist, 'package.json'), JSON.stringify({
  name: pkg.name,
  private: true,
  type: 'module',
  engines: pkg.engines,
  dependencies: pkg.dependencies,
  scripts: { start: 'node server/index.js' },
}, null, 2));
await writeFile(join(dist, 'BUILD.txt'), `built ${new Date().toISOString()}\nstatic root: this directory\nstart: npm install && VALET_OWNER_PASSWORD=... npm start\n`);
console.log(`built ${dist}`);
