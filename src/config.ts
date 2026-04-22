// Zero-config by design. Everything the daemon needs lives here as a constant.
// If someone asks "can I change the screenshot path?", the answer is "fork it
// and edit this file" until there is a real demand for a config file.

import os from 'node:os';
import path from 'node:path';

// Candidate screenshot directories, probed in order at startup. The daemon
// picks the first one that actually exists on the connected device.
//
// This keeps us zero-config across OEMs. Pixel / stock Android / OnePlus
// tend to use /sdcard/Pictures/Screenshots, Samsung One UI uses
// /sdcard/DCIM/Screenshots, older / less common ROMs drop them at the root.
// If your phone stores them elsewhere, add the path here and open a PR.
export const SCREENSHOT_DIR_CANDIDATES = [
  '/sdcard/Pictures/Screenshots/',
  '/sdcard/DCIM/Screenshots/',
  '/sdcard/Screenshots/',
];

// Polling interval. 1 second is the trade-off: fast enough to feel instant
// to the user, slow enough that the adb round-trip cost is negligible.
export const POLL_INTERVAL_MS = 1_000;

// Per-OS temp dir, plus a "droid-clip" subfolder so pulled screenshots don't
// pollute the top-level temp directory and can be inspected if debugging.
export const TMP_DIR = path.join(os.tmpdir(), 'droid-clip');

// File extensions we treat as screenshots. Most Androids write PNG, but some
// screenshot tools / long-screenshot apps produce JPEG.
export const SCREENSHOT_EXTS = ['.png', '.jpg', '.jpeg'];
