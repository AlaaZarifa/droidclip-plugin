import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { AdbClient, adbCommandError, listDevices, selectDevice } from '../dist/adb.js';

const serial = 'adb-Samsung-example._adb-tls-connect._tcp';
const remotePath = '/sdcard/DCIM/Screenshots/Screenshot 2026.png';
const image = { remotePath, size: 4, modified: 1795020000 };

async function withTemporaryDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'droid-clip-adb-test-'));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('device listing parses wireless, offline and unauthorized devices and forwards cancellation', async () => {
  const controller = new AbortController();
  const devices = await listDevices(controller.signal, async (args, options) => {
    assert.deepEqual(args, ['devices', '-l']);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.timeout, 10_000);
    return { stdout: `List of devices attached\r\n${serial} device product:e2s model:SM_S926B device:e2s transport_id:3\r\nUSB123 unauthorized transport_id:4\r\n192.0.2.1:5555 offline\r\n\r\n` };
  });
  assert.deepEqual(devices, [
    { serial, state: 'device', model: 'SM_S926B' },
    { serial: 'USB123', state: 'unauthorized' },
    { serial: '192.0.2.1:5555', state: 'offline' },
  ]);
});

test('device listing distinguishes permissions and rejects invalid output or command failure', async () => {
  const devices = await listDevices(undefined, async () => ({ stdout: 'List of devices attached\nUSB no permissions (user is not in plugdev group)\n' }));
  assert.equal(devices[0].state, 'no permissions');
  await assert.rejects(listDevices(undefined, async () => ({ stdout: 'unexpected result' })), /device list/);
  await assert.rejects(listDevices(undefined, async () => { throw new Error('ADB timed out'); }), /timed out/);
});

test('device selection pins a single device and refuses ambiguous or unavailable devices', () => {
  const samsung = { serial, state: 'device', model: 'SM_S926B' };
  const second = { serial: 'emulator-5554', state: 'device' };
  assert.equal(selectDevice([samsung]), samsung);
  assert.equal(selectDevice([samsung, second], serial), samsung);
  assert.throws(() => selectDevice([]), /No Android device/);
  assert.throws(() => selectDevice([samsung, second]), /Multiple Android devices.*--device/);
  assert.throws(() => selectDevice([samsung], 'missing'), /Requested device missing/);
  for (const state of ['offline', 'unauthorized', 'no permissions']) {
    assert.throws(() => selectDevice([{ serial, state }], serial), new RegExp(state));
  }
});

test('listing monitors every directory and preserves unusual filenames with NUL records', async () => {
  const unusual = `/sdcard/Pictures/Screenshots/ leading '"$;\\\n雪.png`;
  const controller = new AbortController();
  const client = new AdbClient(serial, controller.signal, async (args, options) => {
    assert.deepEqual(args.slice(0, 3), ['-s', serial, 'shell']);
    assert.equal(options.timeout, 10_000);
    assert.equal(options.signal, controller.signal);
    for (const directory of ['/sdcard/Pictures/Screenshots', '/sdcard/DCIM/Screenshots', '/sdcard/Screenshots']) {
      assert.ok(args[3].includes(`'${directory}'`));
    }
    assert.ok(args[3].includes('-maxdepth 1 -type f -print0'));
    return { stdout: [remotePath, unusual, '/sdcard/DCIM/Screenshots/UPPER.PNG', '/sdcard/DCIM/Screenshots/image.jpeg', '/sdcard/DCIM/Screenshots/.nomedia', '/sdcard/DCIM/Screenshots/.pending-123-Screenshot.jpg', '/sdcard/DCIM/Screenshots/.trashed-123-Screenshot.png', remotePath, ''].join('\0') };
  });
  assert.deepEqual(await client.listScreenshots(), [remotePath, unusual, '/sdcard/DCIM/Screenshots/UPPER.PNG', '/sdcard/DCIM/Screenshots/image.jpeg']);
});

test('listing returns empty folders and propagates directory/connection failures without accepting a partial listing', async () => {
  assert.deepEqual(await new AdbClient(serial, undefined, async () => ({ stdout: '' })).listScreenshots(), []);
  await assert.rejects(new AdbClient(serial, undefined, async () => ({ stdout: remotePath })).listScreenshots(), /Incomplete/);
  for (const message of ['No known screenshot directory found', 'Permission denied', 'device offline']) {
    await assert.rejects(new AdbClient(serial, undefined, async () => { throw new Error(message); }).listScreenshots(), new RegExp(message));
  }
});

test('stat sends safely quoted remote filenames through the remote shell', async () => {
  const unusual = `/sdcard/DCIM/Screenshots/ a'";$(echo unsafe)\\\n雪.png`;
  const client = new AdbClient(serial, undefined, async (args) => {
    assert.deepEqual(args.slice(0, 3), ['-s', serial, 'shell']);
    const prefix = "stat -c '%s %Y' ";
    assert.ok(args[3].startsWith(prefix));
    // Parse the same quoted argument using a real local POSIX shell, with
    // printf in place of stat. No phone, filesystem access, or clipboard.
    if (process.platform !== 'win32') {
      const { stdout } = await promisify(execFile)('/bin/sh', ['-c', `printf '%s' ${args[3].slice(prefix.length)}`]);
      assert.equal(stdout, unusual);
    }
    return { stdout: '4 1795020000\n' };
  });
  assert.deepEqual(await client.stat(unusual), { ...image, remotePath: unusual });
  await assert.rejects(client.stat('bad\0path'), /NUL/);
});

test('stat rejects malformed, negative and unsafe metadata', async () => {
  for (const stdout of ['junk', '-1 1795020000', '4 nope', '9007199254740993 1795020000']) {
    await assert.rejects(new AdbClient(serial, undefined, async () => ({ stdout })).stat(remotePath), /metadata/);
  }
});

test('pull pins device, passes paths as arguments, and checks local and remote metadata', async () => {
  await withTemporaryDirectory(async (directory) => {
    const localPath = path.join(directory, `local ' special.png`);
    const controller = new AbortController();
    const commands = [];
    const client = new AdbClient(serial, controller.signal, async (args, options) => {
      commands.push(args);
      assert.equal(options.signal, controller.signal);
      if (args[2] === 'pull') {
        assert.deepEqual(args, ['-s', serial, 'pull', remotePath, localPath]);
        assert.equal(options.timeout, 30_000);
        await fs.writeFile(localPath, Buffer.from([1, 2, 3, 4]));
        return { stdout: '' };
      }
      assert.equal(options.timeout, 10_000);
      return { stdout: '4 1795020000\n' };
    });
    await client.pull(image, localPath);
    assert.equal(commands.length, 2);
  });
});

test('pull rejects incomplete downloads and screenshots modified during transfer', async () => {
  await withTemporaryDirectory(async (directory) => {
    const localPath = path.join(directory, 'image.png');
    const incomplete = new AdbClient(serial, undefined, async () => {
      await fs.writeFile(localPath, Buffer.from([1]));
      return { stdout: '' };
    });
    await assert.rejects(incomplete.pull(image, localPath), /incomplete/);
    for (const metadata of ['5 1795020000', '4 1795020001']) {
      const changing = new AdbClient(serial, undefined, async (args) => {
        if (args[2] === 'pull') await fs.writeFile(localPath, Buffer.from([1, 2, 3, 4]));
        return { stdout: metadata };
      });
      await assert.rejects(changing.pull(image, localPath), /changed during transfer/);
    }
  });
});

test('pull preserves cancellation and failures for caller retry', async () => {
  const abort = new Error('Operation aborted');
  abort.name = 'AbortError';
  const client = new AdbClient(serial, undefined, async () => { throw abort; });
  await assert.rejects(client.pull(image, '/unused'), (error) => error === abort);
});


test('listing ignores Samsung transient thumbnails and hidden pending images', async () => {
  const directory = '/sdcard/DCIM/Screenshots/';
  const names = [
    'thumbnail_Screenshot_20260101_120000_Example App.jpg',
    'THUMBNAIL_Screenshot_20260101_120000_Example App.PNG',
    '.pending-123-Screenshot.jpg',
    '.trashed-123-Screenshot.png',
    'Screenshot_20260101_120000_Example App.jpg',
    'Screenshot_thumbnail_notes.png',
  ];
  const client = new AdbClient(serial, undefined, async () => ({
    stdout: names.map(name => directory + name).join('\0') + '\0',
  }));
  assert.deepEqual(await client.listScreenshots(), [directory + names[4], directory + names[5]]);
});

test('ADB diagnostics omit command scripts and preserve useful stderr', () => {
  const script = 'found=0; for dir in private-paths; do find "$dir"; done';
  const error = Object.assign(new Error(`Command failed: adb shell ${script}`), {
    stderr: '  error: device offline\n', code: 1,
  });
  const formatted = adbCommandError(['-s', serial, 'shell', script], error, 10_000);
  assert.equal(formatted.message, 'ADB screenshot listing failed: error: device offline');
  assert.ok(!formatted.message.includes(script));
  assert.equal(adbCommandError(['-s', serial, 'shell', "stat -c '%s %Y' secret-file"], error, 10_000).message,
    'ADB stat failed: error: device offline');
});

test('ADB diagnostics identify timeouts, termination, exit status and missing executable', () => {
  assert.equal(adbCommandError(['-s', serial, 'pull', 'remote', 'local'], { killed: true, signal: 'SIGTERM' }, 30_000).message,
    'ADB pull failed: command timed out after 30000 ms');
  assert.equal(adbCommandError(['devices', '-l'], { signal: 'SIGTERM' }, 10_000).message,
    'ADB devices failed: terminated by SIGTERM');
  assert.equal(adbCommandError(['devices', '-l'], { code: 7 }, 10_000).message,
    'ADB devices failed: exit code 7');
  assert.match(adbCommandError(['devices', '-l'], { code: 'ENOENT' }, 10_000).message,
    /^ADB devices failed: adb was not found on PATH/);
  assert.equal(adbCommandError(['devices', '-l'], new Error('contains full command'), 10_000).message,
    'ADB devices failed: command could not be completed');
});

test('ADB diagnostic formatting preserves the cancellation error identity', () => {
  const aborted = new Error('Operation aborted');
  aborted.name = 'AbortError';
  assert.equal(adbCommandError(['devices', '-l'], aborted, 10_000), aborted);
});
