package dev.droidclip.studio;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.openapi.project.ProjectManagerListener;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Disposer;
import org.jetbrains.annotations.NotNull;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** One explicitly enabled bridge per IDE, shared by every project widget. */
@Service(Service.Level.APP)
public final class DroidClipService implements Disposable {
    public enum Phase { OFF, STARTING, ACTIVE, WAITING, STOPPING, ERROR }
    public record Snapshot(Phase phase, String detail, boolean enabled) {}
    private record Device(String serial, String label) {}
    private static final Logger LOG = Logger.getInstance(DroidClipService.class);
    private final List<Consumer<Snapshot>> listeners = new CopyOnWriteArrayList<>();
    private final Set<Process> ownedProcesses = new HashSet<>();
    private volatile Snapshot snapshot = new Snapshot(Phase.OFF, "DroidClip Plugin is off. Click to enable screenshot copying.", false);
    private long generation;
    private boolean enabled;
    private boolean disposed;
    private Process bridge;
    private String selectedDevice = "Android";

    public DroidClipService() {
        ApplicationManager.getApplication().getMessageBus().connect(this).subscribe(ProjectManager.TOPIC, new ProjectManagerListener() {
            @Override public void projectClosed(@NotNull Project closed) {
                boolean otherProject = Arrays.stream(ProjectManager.getInstance().getOpenProjects())
                    .anyMatch(project -> project != closed && !project.isDisposed());
                if (!otherProject) stop();
            }
        });
    }

    public static DroidClipService getInstance() {
        return ApplicationManager.getApplication().getService(DroidClipService.class);
    }
    public Snapshot snapshot() { return snapshot; }
    public void addListener(Consumer<Snapshot> listener, Disposable parent) {
        listeners.add(listener);
        Disposer.register(parent, () -> listeners.remove(listener));
        listener.accept(snapshot);
    }

    public synchronized void toggle(Project project) {
        if (disposed || snapshot.phase() == Phase.STOPPING) return;
        if (enabled) { stop(); return; }
        enabled = true;
        long token = ++generation;
        update(Phase.STARTING, "Finding Node.js and your connected Android device…");
        DroidClipSettings.State settings = DroidClipSettings.getInstance().getState();
        // Copy the settings so an Apply action cannot change an in-flight start.
        DroidClipSettings.State requested = new DroidClipSettings.State();
        requested.nodePath = settings.nodePath;
        requested.adbPath = settings.adbPath;
        requested.deviceSerial = settings.deviceSerial;
        ApplicationManager.getApplication().executeOnPooledThread(() -> prepare(project, token, requested));
    }

    private void prepare(Project project, long token, DroidClipSettings.State settings) {
        try {
            BridgeFiles.Tools tools = BridgeFiles.findTools(settings);
            String version = runCommand(token, List.of(tools.node().toString(), "--version")).trim();
            if (!version.matches("v\\d+\\..*") || Integer.parseInt(version.substring(1).split("\\.")[0]) < 18) {
                throw new IOException("Node.js 18 or later is required. Select a newer Node executable in DroidClip Plugin settings.");
            }
            Path script = BridgeFiles.prepare();
            String serial = settings.deviceSerial == null ? "" : settings.deviceSerial.trim();
            if (serial.isEmpty()) {
                List<Device> devices = devices(runCommand(token, List.of(tools.adb().toString(), "devices", "-l")));
                if (devices.size() > 1) {
                    ApplicationManager.getApplication().invokeLater(() -> chooseDevice(project, token, tools, script, devices));
                    return;
                }
                if (devices.size() == 1) serial = devices.getFirst().serial();
            }
            runBridge(project, token, tools, script, serial);
        } catch (CancellationException ignored) {
            // An Off click invalidated this start request.
        } catch (Exception error) { fail(project, token, error); }
    }

    private void chooseDevice(Project project, long token, BridgeFiles.Tools tools, Path script, List<Device> devices) {
        if (!isCurrent(token)) return;
        if (project != null && project.isDisposed()) { stop(); return; }
        String[] labels = devices.stream().map(Device::label).toArray(String[]::new);
        int choice = Messages.showChooseDialog(project, "Which device should DroidClip Plugin watch?", "DroidClip Plugin",
            Messages.getQuestionIcon(), labels, labels[0]);
        if (!isCurrent(token)) return;
        if (choice < 0) { stop(); return; }
        String serial = devices.get(choice).serial();
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try { runBridge(project, token, tools, script, serial); }
            catch (CancellationException ignored) {}
            catch (Exception error) { fail(project, token, error); }
        });
    }

    private static List<Device> devices(String output) {
        List<Device> result = new ArrayList<>();
        for (String line : output.split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("List of devices") || trimmed.startsWith("*")) continue;
            String[] fields = trimmed.split("\\s+");
            if (fields.length < 2) continue;
            String model = Arrays.stream(fields).filter(field -> field.startsWith("model:"))
                .findFirst().map(field -> field.substring(6).replace('_', ' ')).orElse("Android");
            result.add(new Device(fields[0], model + " — " + fields[0] + " (" + fields[1] + ")"));
        }
        return result;
    }

    private void runBridge(Project project, long token, BridgeFiles.Tools tools, Path script, String serial) throws Exception {
        List<String> command = new ArrayList<>(List.of(tools.node().toString(), script.toString(), "--managed"));
        if (!serial.isEmpty()) command.addAll(List.of("--device", serial));
        ProcessBuilder builder = new ProcessBuilder(command).directory(script.getParent().toFile()).redirectErrorStream(true);
        String inherited = builder.environment().getOrDefault("PATH", "/usr/bin:/bin");
        builder.environment().put("PATH", tools.adb().getParent() + File.pathSeparator + tools.node().getParent() + File.pathSeparator + inherited);
        Process process = startOwned(token, builder, true);
        appendLog("Started an explicitly enabled bridge session.");
        try (BufferedReader reader = process.inputReader(StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                appendLog(line);
                if (isCurrent(token)) handleEvent(token, line);
            }
            int exit = process.waitFor();
            synchronized (this) {
                if (isCurrent(token)) {
                    enabled = false;
                    update(exit == 0 ? Phase.OFF : Phase.ERROR,
                        exit == 0 ? "DroidClip Plugin is off." : snapshot.phase() == Phase.ERROR ? snapshot.detail() : "DroidClip Plugin stopped unexpectedly. Right-click the button to view its log.");
                }
            }
        } finally {
            if (process.isAlive()) {
                signalStop(process);
                process.waitFor();
            }
            synchronized (this) {
                ownedProcesses.remove(process);
                if (bridge == process) bridge = null;
            }
        }
    }

    private synchronized void handleEvent(long token, String line) {
        if (!isCurrent(token)) return;
        try {
            JsonObject event = JsonParser.parseString(line).getAsJsonObject();
            String type = text(event, "type");
            String message = text(event, "message");
            if (type.equals("device")) selectedDevice = text(event, "model") + " [" + text(event, "serial") + "]";
            if (type.equals("error")) update(Phase.ERROR, message);
            if (type.equals("status")) {
                switch (text(event, "state")) {
                    case "starting" -> update(Phase.STARTING, "Connecting to your Android device…");
                    case "active" -> update(Phase.ACTIVE, "Watching " + selectedDevice + ". Click to turn off.");
                    case "waiting" -> update(Phase.WAITING, message + " Click to turn off. No ADB settings are changed.");
                    case "stopped" -> update(Phase.STOPPING, "Finishing screenshot cleanup…");
                    default -> { }
                }
            }
        } catch (RuntimeException ignored) {
            // Keep unexpected native stderr in the local log; it is not UI state.
        }
    }
    private static String text(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : "";
    }

    private synchronized Process startOwned(long token, ProcessBuilder builder, boolean node) throws IOException {
        if (!isCurrent(token)) throw new CancellationException();
        Process process = builder.start();
        ownedProcesses.add(process);
        if (node) bridge = process;
        return process;
    }

    private String runCommand(long token, List<String> command) throws Exception {
        Process process = startOwned(token, new ProcessBuilder(command).redirectErrorStream(true), false);
        try {
            if (!process.waitFor(8, TimeUnit.SECONDS)) {
                process.destroyForcibly(); // Only this short-lived client, never the shared ADB server.
                throw new IOException("The " + Path.of(command.getFirst()).getFileName() + " check timed out.");
            }
            if (!isCurrent(token)) throw new CancellationException();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (process.exitValue() != 0) throw new IOException(output.isBlank() ? "Could not start " + command.getFirst() : output.trim());
            return output;
        } finally { synchronized (this) { ownedProcesses.remove(process); } }
    }

    public synchronized void stop() {
        if (disposed || (!enabled && ownedProcesses.isEmpty())) return;
        enabled = false;
        long stopToken = ++generation;
        List<Process> stopping = List.copyOf(ownedProcesses);
        update(stopping.isEmpty() ? Phase.OFF : Phase.STOPPING,
            stopping.isEmpty() ? "DroidClip Plugin is off." : "Cancelling screenshot work…");
        // Managed stdin EOF asks Node to abort its owned ADB/native clipboard
        // work. Keep stdout open so it can report cleanup before exiting.
        for (Process process : stopping) signalStop(process);
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                for (Process process : stopping) process.waitFor();
                synchronized (this) {
                    if (!disposed && generation == stopToken) update(Phase.OFF, "DroidClip Plugin is off. Click to enable screenshot copying.");
                }
                appendLog("Stopped; clipboard work is cancelled. The ADB connection is unchanged.");
            } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        });
    }

    private synchronized void signalStop(Process process) {
        if (process == bridge) {
            try { process.getOutputStream().close(); }
            catch (IOException ignored) { process.destroy(); }
        } else {
            process.destroy(); // Only a directly owned Node/ADB preflight client.
        }
    }
    private synchronized boolean isCurrent(long token) { return !disposed && enabled && token == generation; }
    private synchronized void fail(Project project, long token, Exception error) {
        if (!isCurrent(token)) return;
        enabled = false;
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        update(Phase.ERROR, message);
        appendLog("ERROR: " + message);
        ApplicationManager.getApplication().invokeLater(() -> {
            if (!disposed && snapshot.phase() == Phase.ERROR) NotificationGroupManager.getInstance()
                .getNotificationGroup("DroidClip").createNotification("DroidClip Plugin", message, NotificationType.ERROR)
                .notify(project != null && !project.isDisposed() ? project : null);
        });
    }
    private void update(Phase phase, String detail) {
        Snapshot next = new Snapshot(phase, detail, enabled);
        snapshot = next;
        ApplicationManager.getApplication().invokeLater(() -> {
            if (!disposed && snapshot == next) for (Consumer<Snapshot> listener : listeners) listener.accept(next);
        });
    }

    private static Path logPath() { return Path.of(PathManager.getLogPath(), "droid-clip.log"); }
    private synchronized void appendLog(String message) {
        try {
            Path log = logPath();
            Files.createDirectories(log.getParent());
            if (Files.exists(log) && Files.size(log) > 2_000_000) Files.move(log, log.resolveSibling("droid-clip.previous.log"), StandardCopyOption.REPLACE_EXISTING);
            Files.writeString(log, Instant.now() + " " + message + System.lineSeparator(), StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException error) { LOG.warn("Could not write DroidClip Plugin log", error); }
    }
    public void openLog(Project project) {
        appendLog("Log opened from DroidClip Plugin.");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try { java.awt.Desktop.getDesktop().open(logPath().toFile()); }
            catch (Exception error) {
                ApplicationManager.getApplication().invokeLater(() -> Messages.showInfoMessage(project, "Log location: " + logPath(), "DroidClip Plugin"));
            }
        });
    }
    @Override public synchronized void dispose() {
        disposed = true;
        enabled = false;
        generation++;
        for (Process process : ownedProcesses) signalStop(process);
        listeners.clear();
    }
}
