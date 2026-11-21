package dev.droidclip.studio;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import kotlinx.coroutines.CoroutineScope;
import org.jetbrains.annotations.NotNull;

public final class DroidClipWidgetFactory implements StatusBarWidgetFactory {
    public static final String ID = "DroidClip";

    @Override public @NotNull String getId() { return ID; }
    @Override public @NotNull String getDisplayName() { return "DroidClip Plugin"; }
    @Override public boolean isAvailable(@NotNull Project project) { return true; }
    @Override public boolean isEnabledByDefault() { return true; }
    @Override public boolean canBeEnabledOn(@NotNull StatusBar statusBar) { return true; }
    @Override public @NotNull StatusBarWidget createWidget(@NotNull Project project, @NotNull CoroutineScope scope) {
        return new DroidClipWidget(project);
    }
    @Override public void disposeWidget(@NotNull StatusBarWidget widget) { Disposer.dispose(widget); }
}
