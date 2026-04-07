import { initializeEventHandlers } from "./controllers/index.js";
import { dom } from "./dom.js";
import { fetchRuntimeState, openRuntimeShell } from "./runtime.js";
import { refreshStatus } from "./controllers/polling.js";
import { bootstrapUpdaterGate } from "./controllers/updater.js";
import { initializeShellViewMode, setActiveTab } from "./ui/layout.js";

/**
 * Initializes the modular popup application.
 */
export async function initPopupApp() {
  syncAppVersionLabel();
  const viewContext = initializeShellViewMode();

  if (await maybeRedirectToPreferredShell(viewContext)) {
    return;
  }

  initializeEventHandlers();
  setActiveTab(viewContext.initialTab);
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

async function maybeRedirectToPreferredShell(viewContext) {
  if (!viewContext || viewContext.hasExplicitViewMode === true) {
    return false;
  }

  try {
    const state = await fetchRuntimeState();
    const preferredViewMode =
      state &&
      state.settings &&
      typeof state.settings === "object" &&
      state.settings.preferredViewMode === "windowed"
        ? "windowed"
        : "fullscreen";

    await openRuntimeShell({
      viewMode: preferredViewMode,
      tab: viewContext.initialTab,
    });

    window.setTimeout(() => {
      try {
        window.close();
      } catch (_error) {
        // The preferred shell has already opened, so a close failure is harmless.
      }
    }, 40);
    return true;
  } catch (_error) {
    return false;
  }
}
