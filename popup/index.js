import { initializeEventHandlers } from "./controllers/index.js";
import { dom } from "./dom.js";
import { refreshStatus, startPolling } from "./controllers/polling.js";
import { setActiveTab } from "./ui/layout.js";

/**
 * Initializes the modular popup application.
 */
export function initPopupApp() {
  syncAppVersionLabel();
  initializeEventHandlers();
  void refreshStatus();
  startPolling();
  setActiveTab("overview");
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
