package dev.droidclip.studio;

import com.intellij.openapi.options.ShowSettingsUtil;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.IconLoader;
import com.intellij.openapi.wm.CustomStatusBarWidget;
import com.intellij.ui.JBColor;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

public final class DroidClipWidget implements CustomStatusBarWidget {
    private final Project project;
    private final JButton button;
    private final Timer animation;
    private DroidClipService.Snapshot current;
    private boolean disposed;
    private int angle;

    public DroidClipWidget(Project project) {
        this.project = project;
        current = DroidClipService.getInstance().snapshot();
        button = new JButton() {
            @Override protected void paintComponent(Graphics graphics) {
                Graphics2D g = (Graphics2D) graphics.create();
                try {
                    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                    if (getModel().isRollover() && isEnabled()) {
                        g.setColor(new JBColor(0xE5EAF1, 0x3A3D43));
                        g.fillRoundRect(0, 0, getWidth(), getHeight(), JBUI.scale(5), JBUI.scale(5));
                    }
                    super.paintComponent(g);
                    if (isFocusOwner()) {
                        g.setColor(JBColor.namedColor("Component.focusColor", new JBColor(0x3574F0, 0x548AF7)));
                        g.drawRoundRect(1, 1, getWidth() - 3, getHeight() - 3, JBUI.scale(4), JBUI.scale(4));
                    }
                } finally { g.dispose(); }
            }
        };
        button.setContentAreaFilled(false);
        button.setOpaque(false);
        button.setFocusPainted(false);
        button.setFocusable(true);
        button.setRolloverEnabled(true);
        button.setBorder(JBUI.Borders.empty(2, 5));
        button.setFont(UIManager.getFont("Label.font"));
        button.setIconTextGap(JBUI.scale(4));
        button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        button.setIcon(new StateIcon(IconLoader.getIcon("/icons/droidClip.svg", DroidClipWidget.class)));
        button.addActionListener(event -> DroidClipService.getInstance().toggle(project));
        button.addMouseListener(new MouseAdapter() {
            @Override public void mousePressed(MouseEvent event) { maybeShowPopup(event); }
            @Override public void mouseReleased(MouseEvent event) { maybeShowPopup(event); }
            private void maybeShowPopup(MouseEvent event) {
                if (event.isPopupTrigger()) showPopup(event.getX(), event.getY());
            }
        });
        button.getInputMap(JComponent.WHEN_FOCUSED).put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "droidClipToggle");
        button.getActionMap().put("droidClipToggle", new AbstractAction() {
            @Override public void actionPerformed(ActionEvent event) { button.doClick(); }
        });
        button.getInputMap(JComponent.WHEN_FOCUSED).put(KeyStroke.getKeyStroke(KeyEvent.VK_F10, InputEvent.SHIFT_DOWN_MASK), "droidClipMenu");
        button.getActionMap().put("droidClipMenu", new AbstractAction() {
            @Override public void actionPerformed(ActionEvent event) { showPopup(0, button.getHeight()); }
        });
        animation = new Timer(80, event -> {
            angle = (angle + 30) % 360;
            button.repaint();
        });
        render(current);
        DroidClipService.getInstance().addListener(this::render, this);
    }

    @Override public @NotNull String ID() { return DroidClipWidgetFactory.ID; }
    @Override public @NotNull JComponent getComponent() { return button; }
    @Override public void dispose() {
        disposed = true;
        animation.stop();
    }

    private void render(DroidClipService.Snapshot state) {
        if (disposed) return;
        current = state;
        String label = switch (state.phase()) {
            case OFF -> "Off";
            case STARTING -> "Starting";
            case ACTIVE -> "On";
            case WAITING -> "Waiting";
            case STOPPING -> "Stopping";
            case ERROR -> "Error";
        };
        button.setText("Clip " + label);
        button.setEnabled(state.phase() != DroidClipService.Phase.STOPPING);
        String action = state.phase() == DroidClipService.Phase.STOPPING
                ? "Finishing cancellation."
                : state.enabled() ? "Click to switch off." : "Click to switch on.";
        String detail = state.detail() == null ? "" : state.detail();
        button.setToolTipText("<html><b>DroidClip Plugin — " + label + "</b><br>" + html(detail)
                + "<br>" + action + "<br>Right-click for settings and logs.</html>");
        button.getAccessibleContext().setAccessibleName("DroidClip Plugin, " + label);
        button.getAccessibleContext().setAccessibleDescription(detail + " " + action);
        if (state.phase() == DroidClipService.Phase.STARTING || state.phase() == DroidClipService.Phase.STOPPING) {
            animation.start();
        } else {
            animation.stop();
        }
        button.revalidate();
        button.repaint();
    }

    private void showPopup(int x, int y) {
        if (disposed) return;
        JPopupMenu menu = new JPopupMenu();
        JMenuItem toggle = new JMenuItem(current.enabled() ? "Switch DroidClip Plugin Off" : "Switch DroidClip Plugin On");
        toggle.setEnabled(current.phase() != DroidClipService.Phase.STOPPING);
        toggle.addActionListener(event -> DroidClipService.getInstance().toggle(project));
        menu.add(toggle);
        menu.addSeparator();
        JMenuItem settings = new JMenuItem("DroidClip Plugin Settings…");
        settings.addActionListener(event -> ShowSettingsUtil.getInstance().showSettingsDialog(project, DroidClipConfigurable.class));
        menu.add(settings);
        JMenuItem log = new JMenuItem("Show DroidClip Plugin Log");
        log.addActionListener(event -> DroidClipService.getInstance().openLog(project));
        menu.add(log);
        menu.show(button, x, y);
    }

    private static String html(String value) {
        String text = value.length() > 500 ? value.substring(0, 500) + "…" : value;
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>");
    }

    private final class StateIcon implements Icon {
        private final Icon clipboard;
        private StateIcon(Icon clipboard) { this.clipboard = clipboard; }
        @Override public int getIconWidth() { return clipboard.getIconWidth() + JBUI.scale(11); }
        @Override public int getIconHeight() { return Math.max(clipboard.getIconHeight(), JBUI.scale(16)); }
        @Override public void paintIcon(Component component, Graphics graphics, int x, int y) {
            clipboard.paintIcon(component, graphics, x, y + (getIconHeight() - clipboard.getIconHeight()) / 2);
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                Color color = switch (current.phase()) {
                    case ACTIVE -> new JBColor(0x248A3D, 0x57CC7A);
                    case STARTING, WAITING, STOPPING -> new JBColor(0xA86B00, 0xFFD166);
                    case OFF, ERROR -> new JBColor(0xD92D20, 0xFF7878);
                };
                g.setColor(color);
                int size = JBUI.scale(6);
                int dotX = x + clipboard.getIconWidth() + JBUI.scale(4);
                int dotY = y + (getIconHeight() - size) / 2;
                if (current.phase() == DroidClipService.Phase.STARTING || current.phase() == DroidClipService.Phase.STOPPING) {
                    g.setStroke(new BasicStroke(JBUI.scale(1.5f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                    g.drawArc(dotX, dotY, size, size, angle, 240);
                } else {
                    g.fillOval(dotX, dotY, size, size);
                }
            } finally { g.dispose(); }
        }
    }
}
