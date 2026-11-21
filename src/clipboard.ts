// Platform-specific clipboard writes. Each branch shells out to the native
// tool that the OS already ships with. Avoiding an npm clipboard library
// keeps the dep graph small, which matters for `npx` cold-start time and
// supply-chain surface area.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InvalidScreenshotError } from './errors.js';

// Wait for close as well as cancellation. execFile's AbortError can arrive
// before the native helper has exited; Off must never precede that exit.
function runNativeCommand(
  command: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
): Promise<{ stdout: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let failure: Error | null = null;
    let output = '';
    const child = execFile(command, args, {
      timeout,
      signal,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      failure = error;
      output = stdout;
      if (error) Object.assign(error, { stdout, stderr });
    });
    child.once('close', () => {
      if (failure) reject(failure);
      else resolve({ stdout: output });
    });
  });
}

/**
 * Copies the PNG/JPG file at `imagePath` onto the OS clipboard as an image
 * (not as a file path). Throws on failure. Clipboard errors usually mean
 * platform misconfiguration (e.g. xclip missing), and the user should see
 * the error rather than have it swallowed.
 */
export async function copyImageToClipboard(imagePath: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  switch (process.platform) {
    case 'darwin':
      return copyMac(imagePath, undefined, undefined, signal);
    case 'linux':
      return copyLinux(imagePath, signal);
    case 'win32':
      return copyWindows(imagePath, signal);
    default:
      throw new Error(
        `droid-clip does not support platform "${process.platform}" yet.`,
      );
  }
}

// The optional runner keeps macOS command boundaries testable without changing
// the user's clipboard during automated tests.
export type ClipboardCommandRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string }>;

async function imageFormat(imagePath: string): Promise<'png' | 'jpeg'> {
  const handle = await fs.open(imagePath, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead === 8 && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return 'png';
    }
    if (bytesRead >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) {
      return 'jpeg';
    }
    throw new InvalidScreenshotError('Screenshot is not a PNG or JPEG image.');
  } finally {
    await handle.close();
  }
}

async function imageDimensions(imagePath: string, run: ClipboardCommandRunner): Promise<string> {
  const { stdout } = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', imagePath]);
  const width = stdout.match(/^\s*pixelWidth:\s*(\d+)\s*$/m)?.[1];
  const height = stdout.match(/^\s*pixelHeight:\s*(\d+)\s*$/m)?.[1];
  if (!width || !height || Number(width) === 0 || Number(height) === 0) {
    throw new InvalidScreenshotError('macOS could not read the screenshot image dimensions.');
  }
  return `${width}x${height}`;
}

export async function copyMac(
  imagePath: string,
  run?: ClipboardCommandRunner,
  privatePasteboard?: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const execute: ClipboardCommandRunner = async (command, args) => {
    signal?.throwIfAborted();
    const result = await (run ? run(command, args) : runNativeCommand(command, args, 10_000, signal));
    signal?.throwIfAborted();
    return result;
  };
  const sourcePath = path.resolve(imagePath);
  const format = await imageFormat(sourcePath);
  signal?.throwIfAborted();
  const dimensions = await imageDimensions(sourcePath, execute);
  let conversionDirectory: string | undefined;
  try {
    let pngPath = sourcePath;
    if (format === 'jpeg') {
      // Samsung may save JPEG screenshots. PNGf describes PNG bytes, so a
      // JPEG must be decoded into lossless PNG rather than simply relabelled.
      conversionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'droid-clip-png-'));
      pngPath = path.join(conversionDirectory, 'screenshot.png');
      await execute('/usr/bin/sips', ['-s', 'format', 'png', sourcePath, '--out', pngPath]);
      if (await imageFormat(pngPath) !== 'png' || await imageDimensions(pngPath, execute) !== dimensions) {
        throw new InvalidScreenshotError('JPEG conversion did not produce a PNG with the original dimensions.');
      }
    }

    // JXA calls AppKit directly, avoiding AppleScript's slow binary-data
    // comparison. Paths remain argv, and the original PNG bytes stay intact.
    // A named private pasteboard lets native tests exercise the same code
    // without replacing the user's general clipboard.
    if (privatePasteboard && !privatePasteboard.startsWith('com.droid-clip.test.')) {
      throw new Error('Test pasteboards must use the com.droid-clip.test. prefix.');
    }
    const script = `ObjC.import('AppKit');
function run(argv) {
  var data = $.NSData.dataWithContentsOfFile(argv[0]);
  var image = $.NSBitmapImageRep.imageRepWithData(data);
  if (!data || !(Number(data.length) > 0) || !image || !(Number(image.pixelsWide) > 0) || !(Number(image.pixelsHigh) > 0)) {
    throw Error('INVALID_IMAGE: macOS could not decode the PNG screenshot.');
  }
  var board = argv[1] ? $.NSPasteboard.pasteboardWithName(argv[1]) : $.NSPasteboard.generalPasteboard;
  try {
    board.clearContents;
    if (!board.setDataForType(data, 'public.png')) throw Error('macOS rejected the PNG clipboard write.');
    var readback = board.dataForType('public.png');
    if (!readback || !readback.isEqualToData(data)) throw Error('PNG clipboard readback did not match the screenshot.');
    return '';
  } finally {
    if (argv[1]) board.releaseGlobally;
  }
}`;
    try {
      await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, pngPath, ...(privatePasteboard ? [privatePasteboard] : [])]);
    } catch (error) {
      // execFile's message contains the script itself (including the marker).
      // Classify only the native process's stderr, never the echoed command.
      if (typeof error === 'object' && error !== null && 'stderr' in error
        && typeof error.stderr === 'string' && error.stderr.includes('INVALID_IMAGE:')) {
        throw new InvalidScreenshotError('macOS could not decode the PNG screenshot.');
      }
      throw error;
    }

  } finally {
    if (conversionDirectory) {
      await fs.rm(conversionDirectory, { recursive: true, force: true }).catch((error: unknown) => {
        // Cleanup must not turn a successful copy into a retry/duplicate.
        console.error('[droid-clip] Could not remove PNG conversion directory:', error);
      });
    }
  }
}

async function copyLinux(imagePath: string, signal?: AbortSignal): Promise<void> {
  // xclip is the de-facto X11 tool. Wayland sessions will need wl-copy.
  // I'll add a runtime detection branch if someone reports it.
  await runNativeCommand('xclip', [
    '-selection',
    'clipboard',
    '-t',
    'image/png',
    '-i',
    imagePath,
  ], 30_000, signal);
}

async function copyWindows(imagePath: string, signal?: AbortSignal): Promise<void> {
  // The Windows clipboard API requires a Single-Threaded Apartment (-STA).
  // Without it, SetImage throws InvalidOperationException. -NoProfile keeps
  // startup snappy by skipping the user's PowerShell profile script.
  //
  // We escape single quotes in the path (doubled '') in case a user has an
  // unusual tmp dir. Windows file paths can't contain `'` natively, but
  // username-based paths occasionally do.
  const escaped = imagePath.replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    `$img = [System.Drawing.Image]::FromFile('${escaped}');`,
    "[System.Windows.Forms.Clipboard]::SetImage($img);",
    "$img.Dispose();",
  ].join(' ');

  await runNativeCommand('powershell', [
    '-NoProfile',
    '-STA',
    '-Command',
    command,
  ], 30_000, signal);
}
