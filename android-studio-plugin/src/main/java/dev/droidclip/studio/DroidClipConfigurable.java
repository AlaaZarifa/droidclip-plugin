package dev.droidclip.studio;

import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory;
import com.intellij.openapi.options.ConfigurationException;
import com.intellij.openapi.options.SearchableConfigurable;
import com.intellij.openapi.ui.TextFieldWithBrowseButton;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;

public final class DroidClipConfigurable implements SearchableConfigurable {
    private JPanel panel;
    private TextFieldWithBrowseButton nodePath;
    private TextFieldWithBrowseButton adbPath;
    private JTextField deviceSerial;

    @Override public @NotNull String getId() { return "dev.droidclip.studio.settings"; }
    @Override public String getDisplayName() { return "DroidClip Plugin"; }

    @Override public JComponent createComponent() {
        if (panel != null) return panel;
        panel = new JPanel(new GridBagLayout());
        panel.setBorder(JBUI.Borders.empty(10));
        nodePath = new TextFieldWithBrowseButton();
        adbPath = new TextFieldWithBrowseButton();
        deviceSerial = new JTextField(36);
        nodePath.addBrowseFolderListener(null, FileChooserDescriptorFactory.singleFile().withTitle("Select Node.js Executable"));
        adbPath.addBrowseFolderListener(null, FileChooserDescriptorFactory.singleFile().withTitle("Select ADB Executable"));
        nodePath.setToolTipText("Leave empty to detect your existing Node.js installation.");
        adbPath.setToolTipText("Leave empty to detect ADB in your existing Android SDK.");
        deviceSerial.setToolTipText("Optional. Select one device by its ADB serial when multiple devices are connected.");

        GridBagConstraints c = new GridBagConstraints();
        c.gridx = 0; c.gridy = 0; c.gridwidth = 2; c.weightx = 1;
        c.anchor = GridBagConstraints.WEST; c.fill = GridBagConstraints.HORIZONTAL;
        c.insets = JBUI.insets(0, 0, 14, 0);
        panel.add(new JLabel("<html>Use the <b>Clip</b> button in the status bar to switch screenshot sharing on or off.<br>"
                + "DroidClip Plugin starts off each time Android Studio opens. It does not change wireless debugging.</html>"), c);
        row("Node.js executable:", nodePath, 1);
        row("ADB executable:", adbPath, 2);
        row("Device serial (optional):", deviceSerial, 3);
        c.gridy = 4; c.insets = JBUI.insets(5, 0, 12, 0);
        panel.add(new JLabel("<html>Leave all fields empty for automatic detection.<br>"
                + "If more than one device is connected, DroidClip Plugin will ask you to choose one.</html>"), c);
        JButton automatic = new JButton("Use Automatic Detection");
        automatic.addActionListener(event -> {
            nodePath.setText(""); adbPath.setText(""); deviceSerial.setText("");
        });
        c.gridy = 5; c.fill = GridBagConstraints.NONE;
        panel.add(automatic, c);
        c.gridy = 6; c.fill = GridBagConstraints.HORIZONTAL;
        panel.add(new JLabel("Applying changed settings switches DroidClip Plugin off. Click the status-bar button to start again."), c);
        c.gridy = 7; c.weighty = 1; c.fill = GridBagConstraints.BOTH;
        panel.add(new JPanel(), c);
        reset();
        return panel;
    }

    private void row(String title, JComponent field, int row) {
        GridBagConstraints c = new GridBagConstraints();
        c.gridx = 0; c.gridy = row; c.anchor = GridBagConstraints.WEST;
        c.insets = JBUI.insets(0, 0, 10, 12);
        JLabel label = new JLabel(title);
        label.setLabelFor(field instanceof TextFieldWithBrowseButton browse ? browse.getTextField() : field);
        panel.add(label, c);
        c.gridx = 1; c.weightx = 1; c.fill = GridBagConstraints.HORIZONTAL;
        c.insets = JBUI.insets(0, 0, 10, 0);
        panel.add(field, c);
    }

    @Override public boolean isModified() {
        if (panel == null) return false;
        var state = DroidClipSettings.getInstance().getState();
        return !text(nodePath.getText()).equals(text(state.nodePath))
                || !text(adbPath.getText()).equals(text(state.adbPath))
                || !text(deviceSerial.getText()).equals(text(state.deviceSerial));
    }

    @Override public void apply() throws ConfigurationException {
        if (!isModified()) return;
        String node = text(nodePath.getText());
        String adb = text(adbPath.getText());
        String serial = text(deviceSerial.getText());
        validateExecutable(node, "Node.js");
        validateExecutable(adb, "ADB");
        if (serial.chars().anyMatch(Character::isWhitespace)) {
            throw new ConfigurationException("The device serial must not contain spaces or line breaks.");
        }
        var state = DroidClipSettings.getInstance().getState();
        state.nodePath = node; state.adbPath = adb; state.deviceSerial = serial;
        DroidClipService.getInstance().stop();
    }

    private static void validateExecutable(String value, String name) throws ConfigurationException {
        if (value.isEmpty()) return;
        try {
            Path executable = Path.of(value);
            if (!executable.isAbsolute() || !Files.isRegularFile(executable) || !Files.isExecutable(executable)) {
                throw new ConfigurationException(name + " must be an existing executable selected with the browse button, or leave it empty for automatic detection.");
            }
        } catch (InvalidPathException error) {
            throw new ConfigurationException(name + " path is invalid.");
        }
    }

    @Override public void reset() {
        if (panel == null) return;
        var state = DroidClipSettings.getInstance().getState();
        nodePath.setText(text(state.nodePath)); adbPath.setText(text(state.adbPath)); deviceSerial.setText(text(state.deviceSerial));
    }

    @Override public void disposeUIResources() {
        panel = null; nodePath = null; adbPath = null; deviceSerial = null;
    }

    private static String text(String value) { return value == null ? "" : value.trim(); }
}
