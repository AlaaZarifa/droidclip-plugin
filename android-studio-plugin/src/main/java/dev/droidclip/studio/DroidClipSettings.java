package dev.droidclip.studio;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.*;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.APP)
@State(name = "DroidClipSettings", storages = @Storage(value = "droidClip.xml", roamingType = RoamingType.DISABLED))
public final class DroidClipSettings implements PersistentStateComponent<DroidClipSettings.State> {
    public static final class State {
        public String nodePath = "";
        public String adbPath = "";
        public String deviceSerial = "";
    }
    private State state = new State();
    public static DroidClipSettings getInstance() {
        return ApplicationManager.getApplication().getService(DroidClipSettings.class);
    }
    @Override public @NotNull State getState() { return state; }
    @Override public void loadState(@NotNull State state) { this.state = state; }
}
