# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-22

### Added
- Initial release.
- ADB polling of the Android screenshot directory (`/sdcard/Pictures/Screenshots/`).
- Automatic clipboard copy on macOS, Linux (X11 via `xclip`), and Windows.
- Native desktop notification via `node-notifier` on each new screenshot.
- Graceful, silent retry on ADB disconnect / phone sleep / USB glitches.
- `npx droid-clip` entry point.
