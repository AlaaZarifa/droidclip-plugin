import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AdbClient, listDevices, selectDevice } from './adb.js';
import { copyImageToClipboard } from './clipboard.js';
import { parseOptions } from './config.js';
import { ScreenshotWatcher } from './watcher.js';

const managed = process.argv.slice(2).includes('--managed');

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
}

const log = (message: string): void => {
  if (managed) emit({ type: 'log', message });
  else console.log(`[${new Date().toISOString()}] [droid-clip] ${message}`);
};

function status(state: 'starting' | 'active' | 'waiting' | 'stopped', message: string): void {
  if (managed) emit({ type: 'status', state, message });
  else log(message);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: droid-clip [--device SERIAL] [--interval MS] [--notify] [--managed]

Take a screenshot on your Android phone; paste the image on your computer.
Reuses an existing authorised USB or wireless ADB connection.

  --device SERIAL  Pin a device (required when multiple devices are connected)
  --interval MS    Poll interval, 250–60000 ms (default 1000)
  --notify         Also display desktop notifications (off by default)
  --managed        JSON events; stop when the parent closes standard input
  --help           Show this help

Existing screenshots are ignored at startup. Stop with Ctrl+C.`);
    return;
  }

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (options.managed) {
    // The IDE owns this pipe. Closing the IDE must stop its watcher, even if
    // no explicit stop signal reaches us. Never apply this to normal CLI use.
    process.stdin.on('end', stop);
    process.stdin.on('error', stop);
    process.stdout.on('error', stop);
    process.stdin.resume();
  }
  const sleep = async (milliseconds: number): Promise<void> => {
    await delay(milliseconds, undefined, { signal: controller.signal });
  };
  let temporaryDirectory: string | undefined;
  let lastError = '';
  let failures = 0;
  let connected = false;
  let watcher: ScreenshotWatcher | undefined;
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'droid-clip-'));
    const directory = temporaryDirectory;
    status('starting', `watching for screenshots every ${options.interval} ms (Ctrl+C to stop)`);
    while (!controller.signal.aborted) {
      try {
        if (!watcher) {
          const device = selectDevice(await listDevices(controller.signal), options.device);
          const adb = new AdbClient(device.serial, controller.signal);
          if (managed) emit({ type: 'device', serial: device.serial, model: device.model ?? 'Android' });
          log(`selected ${device.model ?? 'Android'} [${device.serial}]; all ADB operations target this device`);
          watcher = new ScreenshotWatcher({
            list: () => adb.listScreenshots(),
            stat: (remotePath) => adb.stat(remotePath),
            sleep,
            log,
            copy: async (screenshot) => {
              // A fixed, private local name avoids interpreting Android filenames
              // as host paths. Operations never overlap.
              const local = path.join(directory, `screenshot${path.posix.extname(screenshot.remotePath).toLowerCase()}`);
              const started = performance.now();
              try {
                await adb.pull(screenshot, local);
                const transferred = performance.now();
                controller.signal.throwIfAborted();
                await copyImageToClipboard(local, controller.signal);
                controller.signal.throwIfAborted();
                log(`transferred ${screenshot.size} bytes in ${Math.round(transferred - started)} ms; clipboard ready in ${Math.round(performance.now() - transferred)} ms`);
              } finally {
                await fs.rm(local, { force: true }).catch(() => log('temporary file cleanup deferred until shutdown'));
              }
              if (options.notify && !controller.signal.aborted) {
                // A notification failure must never retry an already successful
                // clipboard write. Notifications are optional presentation only.
                try {
                  const { notify } = await import('./notify.js');
                  notify('droid-clip', `Copied ${path.posix.basename(screenshot.remotePath)}`);
                } catch {
                  log('desktop notification unavailable; clipboard is ready');
                }
              }
            },
          });
        }
        await watcher.tick();
        controller.signal.throwIfAborted();
        if (!connected) status('active', lastError ? 'connection/processing recovered; watching the same device' : 'connected; watcher ready');
        connected = true;
        failures = 0;
        lastError = '';
      } catch (error) {
        if (controller.signal.aborted) break;
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) {
          status('waiting', `waiting/retrying: ${message}`);
          log('Pending screenshots are retained. For wireless ADB, keep the phone on the same network and Wireless debugging enabled.');
        }
        connected = false;
        lastError = message;
        failures++;
      }
      await sleep(failures ? Math.min(15_000, Math.max(options.interval, 1_000) * 2 ** Math.min(failures - 1, 4)) : options.interval);
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    try {
      if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      if (options.managed) {
        process.stdin.removeListener('end', stop);
        process.stdin.removeListener('error', stop);
        process.stdin.destroy();
      }
    }
    if (controller.signal.aborted) status('stopped', 'stopped; temporary files removed');
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (managed) emit({ type: 'error', message });
  else console.error('[droid-clip] fatal:', message);
  process.exitCode = 1;
});
