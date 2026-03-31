import { TITLE_SAVE_DEBOUNCE_MS } from "../config.js";
import { dom } from "../dom.js";
import { saveRuntimeTitleOverride } from "../runtime.js";
import { popupState } from "../state.js";
import { showNotice } from "../ui/layout.js";

/**
 * Title-override persistence helpers.
 */

/**
 * Returns whether a target is a title-edit input.
 *
 * @param {EventTarget|null} target
 * @returns {target is HTMLInputElement}
 */
export function isTitleInput(target) {
  return target instanceof HTMLInputElement && target.classList.contains("item-title-input");
}

/**
 * Debounces a title save while the user is typing.
 *
 * @param {string} itemKey
 * @param {string} value
 */
export function queueTitleSave(itemKey, value) {
  if (typeof itemKey !== "string" || !itemKey) {
    return;
  }

  const existingTimer = popupState.titleSaveTimers.get(itemKey);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    void saveTitleOverride(itemKey, value).catch((error) => {
      showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    });
  }, TITLE_SAVE_DEBOUNCE_MS);

  popupState.titleSaveTimers.set(itemKey, timer);
}

/**
 * Flushes every pending debounced title save immediately.
 *
 * @returns {Promise<void>}
 */
export async function flushPendingTitleSaves() {
  const pendingKeys = new Set(popupState.titleSaveTimers.keys());
  const activeInput = isTitleInput(document.activeElement) ? document.activeElement : null;

  if (activeInput && activeInput.dataset.itemKey) {
    pendingKeys.add(activeInput.dataset.itemKey);
  }

  for (const itemKey of pendingKeys) {
    if (typeof itemKey !== "string" || !itemKey) {
      continue;
    }

    const input = dom.itemsList?.querySelector(
      `input.item-title-input[data-item-key="${CSS.escape(itemKey)}"]`,
    );
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }

    await saveTitleOverride(itemKey, input.value);
  }
}

/**
 * Persists a single title override to the background worker.
 *
 * @param {string} itemKey
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function saveTitleOverride(itemKey, value) {
  if (typeof itemKey !== "string" || !itemKey) {
    return;
  }

  const existingTimer = popupState.titleSaveTimers.get(itemKey);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    popupState.titleSaveTimers.delete(itemKey);
  }

  await saveRuntimeTitleOverride(itemKey, value);
}
