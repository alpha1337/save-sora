import { initializeEventHandlers } from "./controllers/index.js";
import { dom } from "./dom.js";
import { refreshStatus, startPolling } from "./controllers/polling.js";
import { bootstrapUpdaterGate } from "./controllers/updater.js";
import { saveRuntimeSettings } from "./runtime.js";
import { popupState } from "./state.js";
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
    await maybeApplyBraveDownloadModeDefault();
    startPolling();
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

async function maybeApplyBraveDownloadModeDefault() {
  if (popupState.downloadModeAutoChecked) {
    return;
  }

  popupState.downloadModeAutoChecked = true;

  const isBrave = await detectBraveBrowser();
  if (!isBrave) {
    return;
  }

  const runtimeSettings =
    popupState.latestRuntimeState &&
    popupState.latestRuntimeState.settings &&
    typeof popupState.latestRuntimeState.settings === "object"
      ? popupState.latestRuntimeState.settings
      : {};
  const hasExplicitChoice = runtimeSettings.hasExplicitDownloadModeChoice === true;
  const currentDownloadMode = runtimeSettings.downloadMode === "direct" ? "direct" : "archive";

  if (hasExplicitChoice || currentDownloadMode === "direct") {
    return;
  }

  await saveRuntimeSettings({
    downloadMode: "direct",
    hasExplicitDownloadModeChoice: false,
  });
  await refreshStatus();
}

async function detectBraveBrowser() {
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === "function") {
      const isBrave = await navigator.brave.isBrave();
      if (isBrave === true) {
        return true;
      }
    }
  } catch (_error) {
    // Fall through to the user-agent heuristics.
  }

  const brands = navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)
    ? navigator.userAgentData.brands
    : [];
  if (brands.some((brand) => typeof brand.brand === "string" && /brave/i.test(brand.brand))) {
    return true;
  }

  return /brave/i.test(navigator.userAgent);
}
