# CLI and wireless ADB

The plugin reuses an authorised Android device from `adb devices -l`. If the phone drops offline, leave the watcher enabled while you restore the connection. If necessary, open **Developer options → Wireless debugging** on the phone and use the IP address and connection port shown there with `adb connect HOST:PORT`. If the Mac is missing from the paired devices list, pair it again. [Android wireless debugging guide](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)

For the standalone CLI, run `npm ci`, `npm run build` and `npm start` from the repository root. To choose a device, use `npm start -- --device SERIAL`. Stop with Ctrl+C.

The bridge ignores existing screenshots at startup and watches new PNG and JPEG files in standard Android screenshot folders. On macOS it preserves original PNG bytes and converts JPEG screenshots to PNG for native image paste. Screenshot transfers stay local. The status-bar toggle controls the plugin's own bridge process.
