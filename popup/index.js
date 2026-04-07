import { initializeEventHandlers } from "./controllers/index.js";
import { dom } from "./dom.js";
import { refreshStatus } from "./controllers/polling.js";
import { bootstrapUpdaterGate } from "./controllers/updater.js";
import { saveRuntimeSettings } from "./runtime.js";
import { initializeShellViewMode, setActiveTab } from "./ui/layout.js";

/**
 * Initializes the modular popup application.
 */
export function initPopupApp() {
  syncAppVersionLabel();
  const { initialTab, viewMode } = initializeShellViewMode();
  initializeEventHandlers();
  setActiveTab(initialTab);
  void saveRuntimeSettings({
    preferredViewMode: viewMode,
  }).catch(() => {});
  void bootstrapUpdaterGate().finally(async () => {
    await refreshStatus();
  });
}

function syncAppVersionLabel() {
  if (!(dom.appVersionLabel instanceof HTMLElement)) {
    return;
  }

  const manifest = chrome.runtime.getManifest();
  const version =
    manifest && typeof manifest.version === "string" && manifest.version
      ? manifest.version
      : null;

  dom.appVersionLabel.textContent = version ? `"Save Sora" v${version}` : '"Save Sora"';
}
