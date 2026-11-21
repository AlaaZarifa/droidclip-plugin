import type { Screenshot } from './adb.js';
import path from 'node:path';
import { InvalidScreenshotError } from './errors.js';

interface WatcherDependencies {
  list(): Promise<string[]>;
  stat(remotePath: string): Promise<Screenshot>;
  copy(screenshot: Screenshot): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
  log(message: string): void;
}

/** Sequential queue: startup files are ignored; failed work stays pending. */
export class ScreenshotWatcher {
  private initialized = false;
  private readonly seen = new Set<string>();
  private readonly detected = new Map<string, number>();
  private readonly invalid = new Map<string, { signature: string; attempts: number }>();

  constructor(private readonly dependencies: WatcherDependencies) {}

  async tick(): Promise<void> {
    const { list, stat, copy, sleep, log } = this.dependencies;
    const paths = await list();
    if (!this.initialized) {
      for (const remotePath of paths) this.seen.add(remotePath);
      this.initialized = true;
      log(`ready; ${paths.length} existing screenshots ignored. Take a screenshot on your phone.`);
      return;
    }

    const current = new Set(paths);
    for (const remotePath of this.detected.keys()) {
      if (!current.has(remotePath)) {
        this.detected.delete(remotePath);
        this.invalid.delete(remotePath);
      }
    }
    const pending: Screenshot[] = [];
    for (const remotePath of current) {
      if (this.seen.has(remotePath)) continue;
      if (!this.detected.has(remotePath)) {
        this.detected.set(remotePath, performance.now());
        log(`detected ${JSON.stringify(remotePath)}`);
      }
      pending.push(await stat(remotePath));
    }
    // Samsung filenames include the capture time, providing a deterministic
    // tie-break when Android reports modification time only to the second.
    pending.sort((a, b) => a.modified - b.modified || path.posix.basename(a.remotePath).localeCompare(path.posix.basename(b.remotePath)) || a.remotePath.localeCompare(b.remotePath));
    if (pending.length === 0) return;

    // One short stability window for the whole batch, not one extra poll/file.
    await sleep(250);
    for (const screenshot of pending) {
      const stable = await stat(screenshot.remotePath);
      if (stable.size !== screenshot.size || stable.modified !== screenshot.modified) {
        // Preserve ordering: never let an older incomplete image replace a
        // newer clipboard image later. A growing file is retried next poll.
        return;
      }
      try {
        if (stable.size === 0) throw new InvalidScreenshotError('Screenshot file is empty.');
        await copy(stable);
      } catch (error) {
        if (!(error instanceof InvalidScreenshotError)) throw error;
        const signature = `${stable.size}:${stable.modified}`;
        const previous = this.invalid.get(stable.remotePath);
        const attempts = previous?.signature === signature ? previous.attempts + 1 : 1;
        this.invalid.set(stable.remotePath, { signature, attempts });
        if (attempts < 3) throw error;
        // Only proven bad files are skipped, never ADB/clipboard failures.
        // Mark them seen so a late repair cannot replace a newer clipboard.
        this.seen.add(stable.remotePath);
        this.detected.delete(stable.remotePath);
        this.invalid.delete(stable.remotePath);
        log(`skipped unusable screenshot after 3 attempts: ${JSON.stringify(stable.remotePath)} (${error.message})`);
        continue;
      }
      this.invalid.delete(stable.remotePath);
      this.seen.add(stable.remotePath);
      const elapsed = performance.now() - this.detected.get(stable.remotePath)!;
      this.detected.delete(stable.remotePath);
      log(`copied ${JSON.stringify(stable.remotePath)}; detection → clipboard ${Math.round(elapsed)} ms`);
    }
  }
}
