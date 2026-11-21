import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyMac } from '../dist/clipboard.js';
import { InvalidScreenshotError } from '../dist/errors.js';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC', 'base64');
const jpegHeader = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70]);
const dimensions = { stdout: '  pixelWidth: 1\n  pixelHeight: 1\n' };

async function fixture(t, bytes = png, name = 'screenshot.png') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'droid-clip-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, name);
  await fs.writeFile(imagePath, bytes);
  return imagePath;
}

async function absent(file) {
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
}

test('PNG is not converted; unusual paths are separate argv and bytes stay unchanged', async (t) => {
  const filename = process.platform === 'win32'
    ? "a 'apostrophe' $dollar `backtick`.png"
    : 'a "quote" \' $dollar `backtick` \\ newline\n.png';
  const imagePath = await fixture(t, png, filename);
  const calls = [];
  await copyMac(imagePath, async (command, args) => {
    calls.push({ command, args });
    return command === '/usr/bin/sips' ? dimensions : { stdout: '' };
  });
  assert.deepEqual(calls[0], {
    command: '/usr/bin/sips',
    args: ['-g', 'pixelWidth', '-g', 'pixelHeight', imagePath],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, '/usr/bin/osascript');
  assert.equal(calls[1].args[4], imagePath);
  assert.ok(!calls[1].args[3].includes(imagePath));
  assert.match(calls[1].args[3], /dataForType\('public.png'\)/);
  assert.match(calls[1].args[3], /isEqualToData\(data\)/);
  assert.deepEqual(await fs.readFile(imagePath), png);
});

test('empty and non-image inputs never reach clipboard commands', async (t) => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('not a screenshot')]) {
    const imagePath = await fixture(t, bytes);
    await assert.rejects(copyMac(imagePath, async () => {
      assert.fail('No native command should run for invalid image signatures');
    }), /not a PNG or JPEG/);
  }
});

test('unreadable image dimensions prevent clipboard updates', async (t) => {
  const imagePath = await fixture(t);
  const calls = [];
  await assert.rejects(copyMac(imagePath, async (command) => {
    calls.push(command);
    return { stdout: 'pixelWidth: <nil>\npixelHeight: <nil>\n' };
  }), /could not read/);
  assert.deepEqual(calls, ['/usr/bin/sips']);
});

test('JPEG conversion uses a private directory, validates PNG and cleans up after copying', async (t) => {
  const imagePath = await fixture(t, jpegHeader, 'Samsung screenshot.jpg');
  let output;
  await copyMac(imagePath, async (command, args) => {
    if (command === '/usr/bin/sips' && args[0] === '-s') {
      assert.deepEqual(args.slice(0, 5), ['-s', 'format', 'png', imagePath, '--out']);
      output = args[5];
      assert.notEqual(path.dirname(output), path.dirname(imagePath));
      const stat = await fs.stat(path.dirname(output));
      if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o700);
      await fs.writeFile(output, png);
    } else if (command === '/usr/bin/osascript') {
      assert.equal(args[4], output);
      assert.deepEqual(await fs.readFile(output), png);
    }
    return dimensions;
  });
  assert.ok(output);
  await absent(path.dirname(output));
  assert.deepEqual(await fs.readFile(imagePath), jpegHeader);
});

test('conversion and clipboard errors clean up conversion files without deleting source', async (t) => {
  for (const failAt of ['conversion', 'clipboard']) {
    const imagePath = await fixture(t, jpegHeader);
    let output;
    await assert.rejects(copyMac(imagePath, async (command, args) => {
      if (command === '/usr/bin/sips' && args[0] === '-s') {
        output = args[5];
        await fs.writeFile(output, png);
        if (failAt === 'conversion') throw new Error('conversion failed');
      }
      if (command === '/usr/bin/osascript') throw new Error('clipboard failed');
      return dimensions;
    }), new RegExp(`${failAt} failed`));
    await absent(path.dirname(output));
    assert.deepEqual(await fs.readFile(imagePath), jpegHeader);
  }
});

test('a mislabeled conversion output or changed dimensions never reaches clipboard', async (t) => {
  for (const failure of ['format', 'dimensions']) {
    const imagePath = await fixture(t, jpegHeader);
    let output;
    await assert.rejects(copyMac(imagePath, async (command, args) => {
      assert.notEqual(command, '/usr/bin/osascript');
      if (args[0] === '-s') {
        output = args[5];
        await fs.writeFile(output, failure === 'format' ? jpegHeader : png);
      }
      if (failure === 'dimensions' && args.at(-1) === output) {
        return { stdout: 'pixelWidth: 2\npixelHeight: 2\n' };
      }
      return dimensions;
    }), /did not produce a PNG/);
    await absent(path.dirname(output));
  }
});

test('real macOS sips converts JPEG into PNG without changing the clipboard', { skip: process.platform !== 'darwin' }, async (t) => {
  const source = await fixture(t);
  const jpegPath = path.join(path.dirname(source), 'Samsung "source".jpg');
  await execFileAsync('/usr/bin/sips', ['-s', 'format', 'jpeg', source, '--out', jpegPath]);
  let output;
  let clipboardCalls = 0;
  await copyMac(jpegPath, async (command, args) => {
    if (command === '/usr/bin/osascript') {
      clipboardCalls += 1;
      output = args[4];
      const data = await fs.readFile(output);
      assert.deepEqual(data.subarray(0, 8), png.subarray(0, 8));
      const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', output]);
      assert.match(stdout, /format: png/);
      assert.match(stdout, /pixelWidth: 1/);
      assert.match(stdout, /pixelHeight: 1/);
      return { stdout: '' };
    }
    return execFileAsync(command, args, { timeout: 10_000 });
  });
  assert.equal(clipboardCalls, 1);
  await absent(path.dirname(output));
});


test('native image validation errors are permanent; clipboard failures stay retryable', async (t) => {
  const imagePath = await fixture(t);
  for (const [message, expected] of [
    ['INVALID_IMAGE: cannot decode image', true],
    ['clipboard server unavailable', false],
  ]) {
    await assert.rejects(copyMac(imagePath, async (command) => {
      if (command === '/usr/bin/osascript') {
        const error = new Error('Command failed: script containing INVALID_IMAGE:');
        error.stderr = message;
        throw error;
      }
      return dimensions;
    }), (error) => (error instanceof InvalidScreenshotError) === expected);
  }
});

test('native JXA writes and verifies original PNG bytes on an isolated private pasteboard', { skip: process.platform !== 'darwin' }, async (t) => {
  const imagePath = await fixture(t, png, 'native "quote" \' path.png');
  await copyMac(imagePath, undefined, `com.droid-clip.test.${randomUUID()}`);
  assert.deepEqual(await fs.readFile(imagePath), png);
});

test('native macOS rejects a corrupt PNG before writing its private pasteboard', { skip: process.platform !== 'darwin' }, async (t) => {
  const imagePath = await fixture(t, png.subarray(0, 16));
  await assert.rejects(
    copyMac(imagePath, undefined, `com.droid-clip.test.${randomUUID()}`),
    InvalidScreenshotError,
  );
});
