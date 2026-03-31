import { initializeEventHandlers } from "./controllers/index.js";
import { refreshStatus, startPolling } from "./controllers/polling.js";
import { setActiveTab } from "./ui/layout.js";

/**
 * Initializes the modular popup application.
 */
export function initPopupApp() {
  initializeEventHandlers();
  void refreshStatus();
  startPolling();
  setActiveTab("overview");
}
