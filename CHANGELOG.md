# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Android Studio plugin 0.1.1

- Add an Android Studio status-bar toggle with device selection, connection status and managed cancellation.
- Bundle the modified CLI and both MIT licences in the installable ZIP.

### Fixed
- macOS now converts JPEG screenshots to actual PNG data before clipboard writes, preserves existing PNG bytes, and checks clipboard readback.
- Pass macOS paths as arguments to a static JXA script; use AppKit for PNG decoding, pasteboard writes, and native byte-for-byte readback.
- Pin all screenshot operations to one selected ADB device and check every supported screenshot directory.
- Ignore the full startup baseline, including initially empty directories; queue new files in order and retry failed work without repeating successful copies.
- Check file stability and transfer size, ignore hidden MediaStore and Samsung thumbnail files, bound ADB commands, and clean temporary image files on completion and graceful shutdown.
- Skip a provably unusable screenshot after three unchanged attempts, with a clear log, while retaining ADB and clipboard failures for retry.

### Added
- Optional `--device`, `--interval`, and `--notify` flags, connection/recovery messages, and processing-time logs.
- Focused automated regression tests and a macOS setup, troubleshooting, and validation guide.

### Changed
- Desktop notifications are opt-in; terminal feedback remains enabled.
- CI runs the regression suite as well as TypeScript compilation.

## [0.1.0] - 2026-04-22

### Added
- Initial release.
- ADB polling of the Android screenshot directory (`/sdcard/Pictures/Screenshots/`).
- Automatic clipboard copy on macOS, Linux (X11 via `xclip`), and Windows.
- Native desktop notification via `node-notifier` on each new screenshot.
- Graceful, silent retry on ADB disconnect / phone sleep / USB glitches.
- `npx droid-clip` entry point.
