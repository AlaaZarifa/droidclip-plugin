// Entry point — wires adb + clipboard + notifier into a single polling loop.
// See CLAUDE.md for why this is polling-based rather than logcat/inotify.

import fs from 'node:fs/promises';
import { adbLatest, adbPull } from './adb.js';
import { copyImageToClipboard } from './clipboard.js';
import { notify } from './notify.js';
import { POLL_INTERVAL_MS, TMP_DIR } from './config.js';

// In-memory marker of "the newest screenshot filename we've observed so far".
// Deliberately not persisted between runs: on restart we re-seed this to
// whatever the phone's current latest is, and only copy screenshots taken
// AFTER the daemon comes up. Otherwise every startup would spam the
// clipboard with a stale screenshot from hours ago.
let lastSeen: string | null = null;

// Set to true once we've successfully talked to the phone at least once.
// Used only to control a first-connect log line — avoids silent confusion
// when the user starts the daemon with the phone not yet plugged in.
let everConnected = false;

async function tick(): Promise<void> {
  let latest: string | null;
  try {
    latest = await adbLatest();
  } catch {
    // adb errors during a tick are routine: phone unplugged, screen locked,
    // USB glitch, adb server restarting. Stay quiet and retry next tick —
    // this is exactly the "graceful disconnect/reconnect" behavior in v1 scope.
    return;
  }

  if (!everConnected) {
    everConnected = true;
    console.log('[droid-clip] connected to device.');
  }

  if (!latest) return;

  // First successful read seeds `lastSeen` without copying. See the comment
  // on the declaration above for why.
  if (lastSeen === null) {
    lastSeen = latest;
    return;
  }

  if (latest === lastSeen) return;

  // New screenshot detected. Update the marker FIRST so a slow pull/copy
  // can't cause us to re-trigger on the same file next tick.
  lastSeen = latest;

  try {
    const localPath = await adbPull(latest);
    await copyImageToClipboard(localPath);
    notify('droid-clip', `Copied ${latest}`);
    console.log(`[droid-clip] copied ${latest}`);
  } catch (err) {
    // Pull or clipboard errors are worth surfacing: usually a missing xclip,
    // a phone disconnect mid-pull, or a genuine platform problem. We don't
    // crash the loop — the next screenshot should work once the issue clears.
    console.error(`[droid-clip] failed to handle ${latest}:`, err);
  }
}

async function main(): Promise<void> {
  // Make sure our tmp subdir exists; adb pull won't create the parent dir.
  await fs.mkdir(TMP_DIR, { recursive: true });

  console.log('[droid-clip] watching for screenshots… (Ctrl+C to stop)');

  // Recursive setTimeout (not setInterval) so a slow tick — e.g. a large
  // screenshot pull over a crowded USB bus — can never cause overlapping
  // runs of tick().
  const loop = async (): Promise<void> => {
    await tick();
    setTimeout(loop, POLL_INTERVAL_MS);
  };

  await loop();
}

main().catch((err) => {
  console.error('[droid-clip] fatal:', err);
  process.exit(1);
});
