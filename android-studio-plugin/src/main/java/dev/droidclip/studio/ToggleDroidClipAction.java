package dev.droidclip.studio;

import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAwareAction;
import org.jetbrains.annotations.NotNull;

public final class ToggleDroidClipAction extends DumbAwareAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) {
        DroidClipService.getInstance().toggle(event.getProject());
    }
    @Override public void update(@NotNull AnActionEvent event) {
        var state = DroidClipService.getInstance().snapshot();
        event.getPresentation().setText(state.enabled() ? "Switch DroidClip Plugin Off" : "Switch DroidClip Plugin On");
        event.getPresentation().setDescription(state.detail());
        event.getPresentation().setEnabled(event.getProject() != null && state.phase() != DroidClipService.Phase.STOPPING);
    }
    @Override public @NotNull ActionUpdateThread getActionUpdateThread() { return ActionUpdateThread.BGT; }
}
