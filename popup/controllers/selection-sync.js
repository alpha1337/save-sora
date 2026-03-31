import { saveSelection } from "../runtime.js";
import { popupState } from "../state.js";
import { renderCurrentItems } from "../ui/render.js";
import { applyCurrentSelectionUi, getSelectedKeysFromDom } from "../ui/selection.js";

/**
 * Persists the current DOM checkbox state and refreshes the local summary UI.
 *
 * This helper exists so list clicks, checkbox changes, and bulk actions all
 * reuse the same selection flow instead of drifting apart over time.
 *
 * @returns {Promise<void>}
 */
export async function updateSelectionFromDom() {
  const selectedKeys = getSelectedKeysFromDom();
  popupState.latestRenderState.selectedKeys = selectedKeys;
  renderCurrentItems();
  applyCurrentSelectionUi();
  await saveSelection(selectedKeys);
}
