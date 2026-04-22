# droid-clip

> Screenshot on your Android, paste on your laptop. A tiny ADB-powered clipboard bridge for AI workflows.

<!-- TODO: replace with a 10-second demo GIF of the full flow -->
<!-- ![demo](./docs/demo.gif) -->

```bash
npx droid-clip
```

Take a screenshot on your USB-connected Android phone and within ~1 second it lands on your laptop clipboard — ready to paste into Claude Code, ChatGPT, Cursor, Discord, anywhere.

## Why

Mobile devs (especially Expo / React Native) hit UI bugs on-device that need AI debugging help. The usual flow is 30–60s of friction per screenshot: take it → AirDrop / email / drag it over → find the file → drag it into chat. `droid-clip` cuts that to one `Cmd+V` / `Ctrl+V`.

The clipboard is deliberately the integration point — it works with every paste-capable tool out there, no MCP / plugin support required on the AI side.

## Install / Run

```bash
npx droid-clip
```

No install, no config file, no signup. Stop with `Ctrl+C`.

## Prerequisites

- **Node.js 18+**
- **`adb`** on your `PATH` — install via [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)
- A USB-connected Android phone with **USB debugging** enabled in Developer Options
- On **Linux** only: `xclip` (`sudo apt install xclip` on Debian/Ubuntu)

## Supported platforms

| OS      | Status | Notes                          |
|---------|--------|--------------------------------|
| macOS   | ✅     | Uses `osascript`               |
| Linux   | ✅     | X11 only, via `xclip`          |
| Windows | ✅     | Uses PowerShell `-STA` mode    |

## Usage

1. Plug your phone in via USB.
2. Accept the "Allow USB debugging" prompt on the phone.
3. Run `npx droid-clip`.
4. Take a screenshot on the phone — it's on your clipboard.

That's the whole app.

## FAQ

**What gets captured?** Whatever the phone saves to `/sdcard/Pictures/Screenshots/`. If your OEM uses a different path (some Samsung builds use `/sdcard/DCIM/Screenshots/`), open an issue.

**Does it send anything to the cloud?** No. The screenshot goes phone → USB → `/tmp/droid-clip/` → your clipboard. That's it.

**Wireless ADB?** If your phone is paired over Wi-Fi ADB, it works exactly the same — `adb` is `adb`.

**iOS?** Not in v1. Tracked as a phase-2 idea (likely Tailscale + an iOS Shortcut), but it's a very different story from USB+ADB.

## Development

```bash
git clone https://github.com/Matzo02/droid-clip.git
cd droid-clip
npm install
npm run build
npm start
```

## Contributing

Issues and PRs welcome — especially bug reports with your phone model + Android version if the screenshot path on your device is different.

## License

[MIT](./LICENSE)
