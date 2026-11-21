import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenshotWatcher } from '../dist/watcher.js';
import { parseOptions } from '../dist/config.js';
import { InvalidScreenshotError } from '../dist/errors.js';

function harness(initial = []) {
  let files = new Map(initial.map(file => [file.remotePath, file]));
  const copied = [];
  const logs = [];
  const state = { onSleep: () => {}, listError: null, copyFailures: 0, invalidPath: null };
  const watcher = new ScreenshotWatcher({
    list: async () => { if (state.listError) throw state.listError; return [...files.keys()]; },
    stat: async name => { assert.ok(files.has(name)); return { ...files.get(name) }; },
    copy: async file => {
      if (file.remotePath === state.invalidPath) throw new InvalidScreenshotError('Invalid image');
      if (state.copyFailures > 0) { state.copyFailures--; throw new Error('temporary transfer failure'); }
      copied.push(file.remotePath);
    },
    sleep: async ms => { assert.equal(ms, 250); state.onSleep(); },
    log: line => logs.push(line),
  });
  return { watcher, copied, logs, state, set: entries => { files = new Map(entries.map(file => [file.remotePath, file])); } };
}
const shot = (name, modified = 1, size = 100) => ({ remotePath: `/sdcard/DCIM/Screenshots/${name}`, modified, size });

test('baselines every existing image and never recopies old images after deletion', async () => {
  const old = shot('old.png'); const latest = shot('latest.png', 2);
  const h = harness([old, latest]);
  await h.watcher.tick(); h.set([old]); await h.watcher.tick();
  assert.deepEqual(h.copied, []);
});

test('an empty initial directory does not swallow the first screenshot', async () => {
  const h = harness(); await h.watcher.tick();
  const first = shot('first.png'); h.set([first]); await h.watcher.tick(); await h.watcher.tick();
  assert.deepEqual(h.copied, [first.remotePath]);
});

test('a burst is processed chronologically, once each, across candidate directories', async () => {
  const h = harness(); await h.watcher.tick();
  const first = shot('Screenshot_001.png', 1);
  const second = { ...shot('Screenshot_002.png', 2), remotePath: '/sdcard/Pictures/Screenshots/Screenshot_002.png' };
  const third = shot('Screenshot_003.png', 3);
  h.set([third, first, second]); await h.watcher.tick(); await h.watcher.tick();
  assert.deepEqual(h.copied, [first.remotePath, second.remotePath, third.remotePath]);
});

test('same-second screenshot names have deterministic capture order', async () => {
  const h = harness(); await h.watcher.tick();
  const a = shot('Screenshot_20260101_120001_App.jpg'); const b = shot('Screenshot_20260101_120002_App.jpg');
  h.set([b, a]); await h.watcher.tick(); assert.deepEqual(h.copied, [a.remotePath, b.remotePath]);
});

test('growing or zero-byte files wait, preserving order', async () => {
  const h = harness(); await h.watcher.tick();
  const a = shot('a.png'); const b = shot('b.png', 2);
  h.set([a, b]); h.state.onSleep = () => h.set([{ ...a, size: 120 }, b]);
  await h.watcher.tick(); assert.deepEqual(h.copied, []);
  h.state.onSleep = () => {}; await h.watcher.tick();
  assert.deepEqual(h.copied, [a.remotePath, b.remotePath]);
  const zero = shot('zero.png', 3, 0); h.set([zero]); await assert.rejects(h.watcher.tick(), /empty/);
  assert.equal(h.copied.length, 2);
});

test('failed copy retries before newer images and successful files are never repeated', async () => {
  const h = harness(); await h.watcher.tick();
  const a = shot('a.png'); const b = shot('b.png', 2); h.set([a, b]); h.state.copyFailures = 1;
  await assert.rejects(h.watcher.tick(), /temporary transfer/); assert.deepEqual(h.copied, []);
  await h.watcher.tick(); await h.watcher.tick(); assert.deepEqual(h.copied, [a.remotePath, b.remotePath]);
});

test('connectivity failure preserves baseline and captures shots taken during interruption', async () => {
  const old = shot('old.png'); const h = harness([old]); await h.watcher.tick();
  h.state.listError = new Error('device offline'); await assert.rejects(h.watcher.tick(), /offline/);
  const recent = shot('recent.png', 2); h.set([old, recent]); h.state.listError = null;
  await h.watcher.tick(); assert.deepEqual(h.copied, [recent.remotePath]);
});

test('a deleted pending file does not block later screenshots', async () => {
  const h = harness(); await h.watcher.tick(); const gone = shot('gone.png'); h.set([gone]);
  h.state.copyFailures = 1; await assert.rejects(h.watcher.tick());
  const next = shot('next.png', 2); h.set([next]); await h.watcher.tick();
  assert.deepEqual(h.copied, [next.remotePath]);
});

test('unusual remote names are preserved and safely escaped in terminal logs', async () => {
  const h = harness(); await h.watcher.tick(); const file = shot(' a "quote"\n$(touch nope).png');
  h.set([file]); await h.watcher.tick(); assert.deepEqual(h.copied, [file.remotePath]);
  assert.ok(h.logs.every(line => !line.includes('\n')));
});

test('CLI defaults and explicit options are validated', () => {
  assert.deepEqual(parseOptions([]), { interval: 1000, help: false, notify: false });
  assert.deepEqual(parseOptions(['--device', 'wireless-id', '--interval', '750', '--notify']), { interval: 750, help: false, notify: true, device: 'wireless-id' });
  for (const args of [['--interval', '0'], ['--interval', 'NaN'], ['--interval', '249'], ['--interval', '60001'], ['--interval'], ['--device'], ['--unknown']]) {
    assert.throws(() => parseOptions(args));
  }
  assert.equal(parseOptions(['--help']).help, true);
});


test('same-second files across folders order by capture filename before directory', async () => {
  const h = harness(); await h.watcher.tick();
  const older = { ...shot('Screenshot_171801.jpg'), remotePath: '/sdcard/Pictures/Screenshots/Screenshot_171801.jpg' };
  const newer = shot('Screenshot_171802.jpg'); h.set([newer, older]); await h.watcher.tick();
  assert.deepEqual(h.copied, [older.remotePath, newer.remotePath]);
});

test('proven invalid images are skipped with a warning after bounded retries', async () => {
  const h = harness(); await h.watcher.tick();
  const bad = shot('bad.png'); const good = shot('good.png', 2);
  h.state.invalidPath = bad.remotePath; h.set([bad, good]);
  await assert.rejects(h.watcher.tick(), /Invalid image/);
  await assert.rejects(h.watcher.tick(), /Invalid image/);
  await h.watcher.tick(); await h.watcher.tick();
  assert.deepEqual(h.copied, [good.remotePath]);
  assert.equal(h.logs.filter(line => line.includes('skipped unusable')).length, 1);
});

test('a permanently empty file cannot silently block future screenshots', async () => {
  const h = harness(); await h.watcher.tick();
  const empty = shot('empty.png', 1, 0); const good = shot('good.png', 2); h.set([empty, good]);
  await assert.rejects(h.watcher.tick(), /empty/); await assert.rejects(h.watcher.tick(), /empty/);
  await h.watcher.tick(); assert.deepEqual(h.copied, [good.remotePath]);
});
