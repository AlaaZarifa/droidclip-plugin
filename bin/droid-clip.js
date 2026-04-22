#!/usr/bin/env node
// Shebang entry used by `npx droid-clip` and by the `bin` field in package.json.
// The real daemon lives in the compiled TypeScript output under dist/.
// We use a dynamic import so any startup error surfaces as a clean exit
// instead of an unhandled ESM module-load exception.
import('../dist/index.js').catch((err) => {
  console.error('[droid-clip] failed to start:', err);
  process.exit(1);
});
