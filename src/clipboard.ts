// Platform-specific clipboard writes. Each branch shells out to the native
// tool that the OS ships with — we deliberately avoid an npm clipboard
// library because keeping the dep graph to `node-notifier` only matters for
// `npx` cold-start time and supply-chain surface area.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Copies the PNG/JPG file at `imagePath` onto the OS clipboard as an image
 * (not as a file path). Throws on failure — clipboard errors usually mean
 * platform misconfiguration (e.g. xclip missing) and the user should see
 * the error rather than have it swallowed.
 */
export async function copyImageToClipboard(imagePath: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      return copyMac(imagePath);
    case 'linux':
      return copyLinux(imagePath);
    case 'win32':
      return copyWindows(imagePath);
    default:
      throw new Error(
        `droid-clip does not support platform "${process.platform}" yet.`,
      );
  }
}

async function copyMac(imagePath: string): Promise<void> {
  // `«class PNGf»` is the AppleScript 4-char code for the PNG pasteboard
  // flavor. Most apps (Claude desktop, Slack, Chrome, Notes, etc.) accept it.
  // Embedding the path in AppleScript is the simplest approach; macOS
  // screenshot filenames do not contain double quotes in practice.
  const script = `set the clipboard to (read (POSIX file "${imagePath}") as «class PNGf»)`;
  await execFileAsync('osascript', ['-e', script]);
}

async function copyLinux(imagePath: string): Promise<void> {
  // xclip is the de-facto X11 tool. Wayland sessions will need wl-copy —
  // we'll add a runtime detection branch if/when someone reports it.
  await execFileAsync('xclip', [
    '-selection',
    'clipboard',
    '-t',
    'image/png',
    '-i',
    imagePath,
  ]);
}

async function copyWindows(imagePath: string): Promise<void> {
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

  await execFileAsync('powershell', [
    '-NoProfile',
    '-STA',
    '-Command',
    command,
  ]);
}
