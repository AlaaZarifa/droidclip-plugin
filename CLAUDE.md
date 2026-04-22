# CLAUDE.md — droid-clip

## What This Is

A tiny CLI daemon that watches a USB-connected Android phone for new screenshots and auto-copies them to the laptop's clipboard. Goal: screenshot on phone → paste directly into Claude Code / Codex / ChatGPT / Cursor / any paste-capable interface. No AirDrop, no email-to-self, no manual file transfer.

## Why It Exists

Mobile devs (especially Expo / React Native) hit UI bugs on-device that need AI debugging help. Current workflow: screenshot → AirDrop/email/drag to laptop → find the file → drag into chat. 30-60 seconds of friction, many times per day. droid-clip cuts it to ~1-2 seconds.

## The Core Design Choice — Clipboard, not MCP

Clipboard works with **every** AI tool (Claude Code, Codex CLI, claude.ai web, ChatGPT web, Cursor, Windsurf, Discord, Slack). MCP would lock this to MCP-capable clients only. Paste is also user-initiated — the user decides which conversation gets the screenshot, which keeps things in control.

This decision is load-bearing. Do not add an MCP mode in v1.

## Tech Stack

- **Runtime:** Node.js + TypeScript (strict)
- **Distribution:** `npx droid-clip`, published on npm, source on GitHub
- **Deps:** `node-notifier` for cross-platform notifications. That's it.
- **Prereq:** `adb` must be in the user's PATH (already true for any Android dev)

## Architecture

```
📱 Android (screenshot)
       │
       ▼  (~1s later, via ADB polling)
💻 daemon  →  OS clipboard  →  🔔 native notification
       │
       └──  Cmd+V wherever
```

One loop:
1. Poll `adb shell ls -t /sdcard/Pictures/Screenshots/ | head -n 1` every 1s
2. On new filename: `adb pull` it to `/tmp/`
3. Copy image to clipboard via platform-specific command
   - **macOS:** `osascript` with `«class PNGf»`
   - **Linux:** `xclip -selection clipboard -t image/png`
   - **Windows:** PowerShell `[Windows.Forms.Clipboard]::SetImage`
4. `node-notifier` → native toast
5. Continue polling

Polling chosen over logcat watching for simplicity. 1s latency is fine; logcat parsing is fragile across Android versions.

## Project Structure

```
droid-clip/
├── src/
│   ├── index.ts        # entry point, starts the daemon loop
│   ├── adb.ts          # adbLatest(), adbPull() wrappers
│   ├── clipboard.ts    # copyImageToClipboard() — platform-switch inside
│   ├── notify.ts       # thin wrapper over node-notifier
│   └── config.ts       # SCREENSHOT_DIR, POLL_INTERVAL_MS, TMP_DIR
├── bin/
│   └── droid-clip.js   # shebang entry for npx
├── package.json        # "bin": { "droid-clip": "./bin/droid-clip.js" }
├── tsconfig.json
├── README.md           # install, usage, 10s demo GIF
├── CHANGELOG.md
├── LICENSE             # MIT
└── .github/workflows/ci.yml
```

## v1 Scope (ship this weekend)

- [ ] Watch Android screenshot dir via ADB polling
- [ ] Pull new screenshots to `/tmp/`
- [ ] Copy to clipboard on macOS, Linux, Windows
- [ ] Native notification on new screenshot
- [ ] Graceful handling of ADB disconnect/reconnect (silent retry)
- [ ] `npx droid-clip` works out of the box
- [ ] README with: one-line install, one-line usage, demo GIF placeholder

## Explicitly Out of Scope for v1

- iOS support (phase 2 — via Tailscale + iOS Shortcut, NOT MCP)
- Hotkey to capture current phone screen (phase 2)
- Screenshot history / picker UI (phase 3)
- MCP mode (off the table — clipboard IS the pitch)
- Config file (zero-config is part of the value prop)
- Cloud sync / multi-device
- Paid tier / signup / telemetry

## Anti-Patterns — Do NOT Do

- Don't build a clever inotify/logcat watcher in v1. Polling works.
- Don't add a config file. Defaults only.
- Don't bundle adb. Just error clearly if it's missing from PATH.
- Don't add classes where plain functions work.
- Don't add any analytics, telemetry, or license keys.
- Don't add dependencies beyond `node-notifier` + TS dev deps.

## Coding Conventions

- TypeScript strict mode, ES2022 target, `"module": "Node16"` ESM
- One concern per file under `src/`
- Plain functions over classes
- Errors from ADB during a tick → catch silently, phone disconnects are normal
- Errors from clipboard → surface to user (platform misconfiguration)
- Logs: minimal. Start message, per-screenshot notification line, fatal errors

## Launch Plan (when v1 is done)

1. `npm publish` under a name that's free (`droid-clip`, `clipdroid`, `snap2clip`, or pick when you check npm)
2. GitHub repo public, MIT license
3. README:
   - 10-second GIF of the full flow at the very top
   - One-sentence value prop
   - `npx droid-clip` on the first visible line
   - Supported OSes, prereqs, usage
4. Posts, spaced 24h+ apart in this order:
   - r/reactnative
   - r/androiddev
   - r/ClaudeAI
   - Show HN
   - Dev Twitter / X with video
5. Reply to every comment/issue in first 48h — 1st-week responsiveness is what builds trust

## Nice-to-Haves Post-Launch (only if users ask)

- Hotkey capture of current screen (`adb exec-out screencap -p`, doesn't need a screenshot on phone)
- `droid-clip history` — pick from last N snaps
- iOS support via Tailscale + iOS screenshot-trigger Shortcut that POSTs to the daemon
- Simultaneous multi-device
- OCR + "caption on clipboard" mode
- Optional upload to a personal-memory DB (bridge to a bigger project later)

## Context on the Person Building This

Solo Indian dev learning MCP + AI tooling. Previously built a D2C Fashion MCP server + Next.js chat UI as a learning exercise (`c:\Mcp - plugin test\`). Pivoted away from product-market-fit thinking toward "build something I personally use daily, open-source it, get involved in the community."

droid-clip is that output. Priorities, in order:
1. Ship something small and useful
2. Actually use it for weeks (dogfood)
3. Get OSS community exposure
4. Learn by building

Not building to monetize. Not building to impress. Building to participate.
