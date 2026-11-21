import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'droid-clip-cli-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const temporary = path.join(root, 'temp');
  const binaries = path.join(root, 'bin');
  await fs.mkdir(temporary);
  await fs.mkdir(binaries);
  return { root, temporary, binaries, environment: {
    ...process.env, PATH: binaries, TMPDIR: temporary, TEMP: temporary, TMP: temporary,
  } };
}

function start(t, args, environment) {
  const child = spawn(process.execPath, args, {
    cwd: repository,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const changed = new EventEmitter();
  let output = '';
  let result;
  let spawnError;
  const collect = data => { output += data.toString(); changed.emit('change'); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    result = { code, signal, error: spawnError };
    changed.emit('change');
    resolve(result);
  }));
  // A failing readiness assertion must never leave an infinite watcher alive.
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 5_000);
  closed.then(() => clearTimeout(watchdog));
  t.after(async () => {
    if (!result) child.kill('SIGKILL');
    await closed;
  });
  return {
    child,
    closed,
    output: () => output,
    waitFor: async text => {
      const signal = AbortSignal.timeout(4_000);
      while (!output.includes(text)) {
        if (result) throw new Error(`CLI exited before ${JSON.stringify(text)}: ${output}`);
        await once(changed, 'change', { signal });
      }
    },
  };
}

test('CLI help exits without ADB or temporary files', { timeout: 10_000 }, async t => {
  const isolated = await sandbox(t);
  // PATH contains no executables. --help must not try to run adb.
  const cli = start(t, ['bin/droid-clip.js', '--help'], isolated.environment);
  const result = await cli.closed;
  assert.equal(result.code, 0, cli.output());
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  assert.match(cli.output(), /Usage: droid-clip/);
  assert.deepEqual(await fs.readdir(isolated.temporary), []);
});

test('repeated SIGINT during asynchronous shutdown removes the private session directory', {
  skip: process.platform === 'win32' ? 'POSIX signal and executable fixture integration' : false,
  timeout: 10_000,
}, async t => {
  const isolated = await sandbox(t);
  const fakeAdb = path.join(isolated.binaries, 'adb');
  await fs.writeFile(fakeAdb, `#!/bin/sh
if [ "$1" = devices ]; then
  printf 'List of devices attached\\ntest-samsung-wireless device model:SM_S926B\\n'
elif [ "$1" = -s ] && [ "$2" = test-samsung-wireless ] && [ "$3" = shell ]; then
  exit 0
else
  printf 'Unexpected fake ADB arguments\\n' >&2
  exit 1
fi
`, { mode: 0o700 });

  // Slow only the child's final recursive cleanup so the second signal
  // reliably arrives while that cleanup is awaited, rather than relying on
  // machine speed or creating hundreds of temporary fixture files.
  const preload = path.join(isolated.root, 'delay-cleanup.cjs');
  await fs.writeFile(preload, `const fs = require('node:fs/promises');
const original = fs.rm;
fs.rm = async function (target, options) {
  if (options && options.recursive) {
    process.stdout.write('TEST cleanup started\\n');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return original.call(this, target, options);
};
`);
  const cli = start(t, ['--require', preload, 'bin/droid-clip.js'], isolated.environment);
  await cli.waitFor('connected; watcher ready');
  const created = await fs.readdir(isolated.temporary);
  assert.equal(created.length, 1);
  assert.match(created[0], /^droid-clip-/);

  assert.equal(cli.child.kill('SIGINT'), true);
  await cli.waitFor('TEST cleanup started');
  assert.equal(cli.child.kill('SIGINT'), true);
  const result = await cli.closed;
  assert.equal(result.code, 0, cli.output());
  assert.equal(result.signal, null, cli.output());
  assert.match(cli.output(), /stopped; temporary files removed/);
  assert.deepEqual(await fs.readdir(isolated.temporary), []);
});
