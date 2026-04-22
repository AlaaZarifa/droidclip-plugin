// Thin wrapper over node-notifier. Kept as its own file so swapping to a
// different backend later (or mocking it in tests) is a one-file change.

import notifier from 'node-notifier';

/**
 * Fire-and-forget desktop notification. We intentionally don't await the
 * notifier callback or throw on failure — a missed toast (headless CI,
 * Do-Not-Disturb, locked screen) should never take the daemon down.
 */
export function notify(title: string, message: string): void {
  notifier.notify({
    title,
    message,
    sound: false,
  });
}
