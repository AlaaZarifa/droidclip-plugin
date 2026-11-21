package dev.droidclip.studio;

import com.intellij.openapi.application.PathManager;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.util.*;

final class BridgeFiles {
    record Tools(Path node, Path adb) {}

    static Tools findTools(DroidClipSettings.State settings) throws IOException {
        String home = System.getProperty("user.home");
        boolean windows = System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win");
        String nodeName = windows ? "node.exe" : "node";
        String adbName = windows ? "adb.exe" : "adb";
        List<Path> nodes = new ArrayList<>();
        for (String directory : List.of("/opt/homebrew/bin", "/usr/local/bin", home + "/.volta/bin", home + "/.local/share/mise/shims")) {
            nodes.add(Path.of(directory, nodeName));
        }
        List<Path> adbs = new ArrayList<>();
        for (String variable : List.of("ANDROID_HOME", "ANDROID_SDK_ROOT")) {
            String sdk = System.getenv(variable);
            if (sdk != null && !sdk.isBlank()) adbs.add(Path.of(sdk, "platform-tools", adbName));
        }
        for (String sdk : List.of(home + "/Library/Android/sdk", home + "/Android/Sdk", home + "/AppData/Local/Android/Sdk")) {
            adbs.add(Path.of(sdk, "platform-tools", adbName));
        }
        String environmentPath = System.getenv("PATH");
        if (environmentPath != null) {
            for (String directory : environmentPath.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator))) {
                if (!directory.isBlank()) {
                    nodes.add(Path.of(directory, nodeName));
                    adbs.add(Path.of(directory, adbName));
                }
            }
        }
        return new Tools(find(settings.nodePath, nodes, "Node.js"), find(settings.adbPath, adbs, "ADB"));
    }

    private static Path find(String configured, List<Path> candidates, String tool) throws IOException {
        if (configured != null && !configured.isBlank()) candidates = List.of(Path.of(configured.trim()));
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toAbsolutePath();
        }
        throw new IOException(tool + " was not found. Open Settings → Tools → DroidClip Plugin and select its executable.");
    }

    static Path prepare() throws IOException {
        Path directory = Path.of(PathManager.getSystemPath(), "droid-clip", "bridge-0.1.1");
        Files.createDirectories(directory);
        // A private cache copy lets the plugin run without depending on an
        // Android project, the development checkout, or an npm installation.
        for (String file : List.of("package.json", "LICENSE", "index.js", "adb.js", "clipboard.js", "config.js", "watcher.js", "errors.js")) {
            try (InputStream input = BridgeFiles.class.getResourceAsStream("/bridge/" + file)) {
                if (input == null) throw new IOException("The plugin is missing its bundled bridge: " + file);
                Path temporary = Files.createTempFile(directory, ".extract-", ".tmp");
                try {
                    Files.copy(input, temporary, StandardCopyOption.REPLACE_EXISTING);
                    try {
                        Files.move(temporary, directory.resolve(file), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                    } catch (AtomicMoveNotSupportedException ignored) {
                        Files.move(temporary, directory.resolve(file), StandardCopyOption.REPLACE_EXISTING);
                    }
                } finally { Files.deleteIfExists(temporary); }
            }
        }
        return directory.resolve("index.js");
    }
}
