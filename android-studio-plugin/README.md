# Build DroidClip Plugin

The Android Studio plugin uses the TypeScript bridge at the root of this fork. To build on macOS with Python 3, Node.js 18+ and an installed Android Studio 261.x SDK, run these commands from the repository root.

    npm ci
    npm test
    python3 android-studio-plugin/build.py

The ZIP is written to `android-studio-plugin/build/distributions/`. For another Android Studio installation, pass `--studio "/path/to/Android Studio.app/Contents"`. The plugin bundles the compiled bridge and both MIT licences.

The plugin starts off each time Android Studio opens. All open projects share the same toggle. Right-click it for the bridge log and optional Node, ADB and device settings. If the widget is hidden, right-click the status bar and enable **DroidClip Plugin** or use **Tools → DroidClip Plugin**.
