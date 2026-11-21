export const SCREENSHOT_DIR_CANDIDATES = [
  '/sdcard/Pictures/Screenshots/',
  '/sdcard/DCIM/Screenshots/',
  '/sdcard/Screenshots/',
];
export const SCREENSHOT_EXTS = ['.png', '.jpg', '.jpeg'];
export const POLL_INTERVAL_MS = 1_000;

export interface Options {
  device?: string;
  interval: number;
  notify: boolean;
  help: boolean;
  managed?: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { interval: POLL_INTERVAL_MS, notify: false, help: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--device':
        options.device = args[++i];
        if (!options.device || options.device.startsWith('--')) throw new Error('--device requires an ADB serial.');
        break;
      case '--interval': {
        const value = args[++i];
        const milliseconds = Number(value);
        if (!value || !Number.isInteger(milliseconds) || milliseconds < 250 || milliseconds > 60_000) {
          throw new Error('--interval must be an integer from 250 to 60000 milliseconds.');
        }
        options.interval = milliseconds;
        break;
      }
      case '--notify': options.notify = true; break;
      case '--managed': options.managed = true; break;
      case '--help':
      case '-h': options.help = true; break;
      default: throw new Error(`Unknown option: ${args[i]}. Use --help.`);
    }
  }
  return options;
}
