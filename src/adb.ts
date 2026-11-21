import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { SCREENSHOT_DIR_CANDIDATES, SCREENSHOT_EXTS } from './config.js';

const execFileAsync = promisify(execFile);

export type Device = { serial: string; state: string; model?: string };
export type Screenshot = { remotePath: string; size: number; modified: number };
export type AdbRunner = (
  args: string[],
  options: { timeout: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr?: string }>;

const runAdb: AdbRunner = async (args, options) => {
  try {
    return await execFileAsync('adb', args, {
      ...options,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw adbCommandError(args, error, options.timeout);
  }
};

// execFile's default error message includes the complete remote shell script.
// Keep diagnostics actionable without printing that script on every retry.
export function adbCommandError(args: string[], error: unknown, timeout: number): Error {
  if (error instanceof Error && error.name === 'AbortError') return error;
  const command = args[0] === '-s' ? args.slice(2) : args;
  const operation = command[0] === 'shell'
    ? (command[1]?.startsWith('stat ') ? 'stat' : 'screenshot listing')
    : command[0] ?? 'command';
  const failure = typeof error === 'object' && error !== null
    ? error as { stderr?: unknown; code?: unknown; signal?: unknown; killed?: unknown }
    : {};
  let detail = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
  if (!detail) {
    if (failure.code === 'ENOENT') {
      detail = 'adb was not found on PATH. Add your Android SDK platform-tools directory to PATH.';
    } else if (failure.killed) {
      detail = `command timed out after ${timeout} ms`;
    } else if (failure.signal) {
      detail = `terminated by ${String(failure.signal)}`;
    } else if (failure.code !== undefined) {
      detail = `exit code ${String(failure.code)}`;
    } else {
      detail = 'command could not be completed';
    }
  }
  return new Error(`ADB ${operation} failed: ${detail}`);
}

export async function listDevices(
  signal?: AbortSignal,
  runner: AdbRunner = runAdb,
): Promise<Device[]> {
  const { stdout } = await runner(['devices', '-l'], { timeout: 10_000, signal });
  const lines = stdout.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('List of devices attached'));
  if (header < 0) throw new Error('Could not read the ADB device list.');

  return lines.slice(header + 1).filter((line) => line.trim()).map((line) => {
    const match = /^(\S+)\s+(\S+)(.*)$/.exec(line);
    if (!match) throw new Error('Could not parse an entry in the ADB device list.');
    const [, serial, state, detail] = match;
    const model = /(?:^|\s)model:(\S+)/.exec(detail)?.[1];
    return {
      serial,
      state: state === 'no' && /^\s+permissions\b/.test(detail) ? 'no permissions' : state,
      ...(model ? { model } : {}),
    };
  });
}

export function selectDevice(devices: Device[], requested?: string): Device {
  let device: Device | undefined;
  if (requested) {
    device = devices.find((entry) => entry.serial === requested);
    if (!device) {
      throw new Error(`Requested device ${requested} is not connected. Check adb devices -l and reconnect wireless ADB.`);
    }
  } else {
    if (devices.length === 0) {
      throw new Error('No Android device is connected. Enable wireless debugging and reconnect with adb connect HOST:PORT.');
    }
    if (devices.length > 1) {
      throw new Error(`Multiple Android devices are connected. Select one with --device SERIAL: ${devices.map((entry) => `${entry.serial} (${entry.state})`).join(', ')}`);
    }
    device = devices[0];
  }

  if (device.state === 'unauthorized') {
    throw new Error(`Device ${device.serial} is unauthorized. Accept the debugging authorization on the phone, or pair wireless debugging.`);
  }
  if (device.state === 'offline') {
    throw new Error(`Device ${device.serial} is offline. Check wireless debugging and reconnect the same device.`);
  }
  if (device.state !== 'device') {
    throw new Error(`Device ${device.serial} is unavailable (${device.state}). Check adb devices -l.`);
  }
  return device;
}

// adb shell joins its arguments into a remote shell command. execFile alone
// does not escape that second shell; quote every remote path as one argument.
function shellQuote(value: string): string {
  if (value.includes('\0')) throw new Error('Android paths cannot contain NUL bytes.');
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export class AdbClient {
  constructor(
    readonly serial: string,
    private readonly signal?: AbortSignal,
    private readonly runner: AdbRunner = runAdb,
  ) {}

  async listScreenshots(): Promise<string[]> {
    const directories = SCREENSHOT_DIR_CANDIDATES.map((dir) => dir.replace(/\/$/, ''));
    // Probe every candidate on every poll: an existing empty folder is not
    // evidence that Samsung currently saves screenshots there. NUL framing
    // preserves spaces, quotes, Unicode, and even newlines in filenames.
    const command = [
      'found=0',
      `for dir in ${directories.map(shellQuote).join(' ')}; do`,
      // Check existing ancestors so inaccessible paths are not mistaken for
      // missing folders. find itself reports unreadable screenshot folders.
      'parent=${dir%/*}',
      'while [ -n "$parent" ]; do',
      'if [ -d "$parent" ] && [ ! -x "$parent" ]; then',
      'printf "Cannot access screenshot directory ancestor: %s\\n" "$parent" >&2; exit 1',
      'fi',
      'parent=${parent%/*}',
      'done',
      'if [ -d "$dir" ]; then',
      'found=1',
      'find "$dir" -maxdepth 1 -type f -print0 || exit $?',
      'elif [ -e "$dir" ]; then',
      'printf "Screenshot path is not a directory: %s\\n" "$dir" >&2; exit 1',
      'fi',
      'done',
      'if [ "$found" -eq 0 ]; then',
      `printf '%s\\n' ${shellQuote(`No known screenshot directory found. Tried: ${directories.join(', ')}`)} >&2`,
      'exit 1',
      'fi',
    ].join('\n');
    const { stdout } = await this.run(['shell', command]);
    if (stdout && !stdout.endsWith('\0')) {
      throw new Error('Incomplete screenshot directory listing from ADB.');
    }
    return [...new Set(stdout.split('\0').filter((remotePath) => {
      // MediaStore uses hidden .pending/.trashed names while saving/deleting;
      // Samsung also creates short-lived thumbnail_Screenshot... images here.
      const name = path.posix.basename(remotePath);
      return remotePath && !name.startsWith('.') && !/^thumbnail_/i.test(name)
        && SCREENSHOT_EXTS.includes(path.posix.extname(remotePath).toLowerCase());
    }))];
  }

  async stat(remotePath: string): Promise<Screenshot> {
    const { stdout } = await this.run(['shell', `stat -c '%s %Y' ${shellQuote(remotePath)}`]);
    const match = /^(\d+)\s+(\d+)\s*$/.exec(stdout);
    if (!match) throw new Error(`Could not read screenshot metadata: ${remotePath}`);
    const size = Number(match[1]);
    const modified = Number(match[2]);
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(modified)) {
      throw new Error(`Invalid screenshot metadata: ${remotePath}`);
    }
    return { remotePath, size, modified };
  }

  async pull(file: Screenshot, localPath: string): Promise<void> {
    await this.run(['pull', file.remotePath, localPath], 30_000);
    const local = await fs.stat(localPath);
    if (!local.isFile() || local.size !== file.size) {
      throw new Error(`Screenshot transfer is incomplete or the file changed: ${file.remotePath}`);
    }
    const after = await this.stat(file.remotePath);
    if (after.size !== file.size || after.modified !== file.modified) {
      throw new Error(`Screenshot changed during transfer: ${file.remotePath}`);
    }
  }

  private run(args: string[], timeout = 10_000): Promise<{ stdout: string; stderr?: string }> {
    return this.runner(['-s', this.serial, ...args], { timeout, signal: this.signal });
  }
}
