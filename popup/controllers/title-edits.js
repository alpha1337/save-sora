import { dom } from "../dom.js";
import { saveRuntimeTitleOverride } from "../runtime.js";
import { popupState } from "../state.js";
import { showNotice, updateAppScrollLock } from "../ui/layout.js";
import { renderCurrentItems } from "../ui/render.js";
import { getDefaultItemTitle, getItemKey, resolveItemTitle } from "../utils/items.js";
import { refreshStatus } from "./polling.js";

/**
 * Opens the modal title editor for the requested item.
 *
 * @param {string} itemKey
 */
export function openTitleDialog(itemKey) {
  if (!(dom.titleDialog instanceof HTMLDialogElement)) {
    return;
  }

  const dialogItem = findDialogItem(itemKey);
  if (!dialogItem) {
    showNotice(dom.errorBox, "That video is no longer in the current set.");
    return;
  }

  const currentTitle = resolveItemTitle(dialogItem, popupState.latestRenderState.titleOverrides);
  const defaultTitle = getDefaultItemTitle(dialogItem);

  popupState.titleDialogItemKey = itemKey;
  popupState.titleDialogDefaultTitle = defaultTitle;
  popupState.titleDialogInitialTitle = currentTitle;

  if (dom.titleDialogInput instanceof HTMLTextAreaElement) {
    dom.titleDialogInput.value = currentTitle;
    dom.titleDialogInput.placeholder = currentTitle;
  }

  if (!dom.titleDialog.open) {
    dom.titleDialog.showModal();
  }

  updateAppScrollLock();

  window.requestAnimationFrame(() => {
    if (!(dom.titleDialogInput instanceof HTMLTextAreaElement)) {
      return;
    }

    dom.titleDialogInput.focus();
    dom.titleDialogInput.setSelectionRange(0, dom.titleDialogInput.value.length);
  });
}

/**
 * Saves the current modal title edit immediately when needed.
 *
 * @returns {Promise<void>}
 */
export async function flushPendingTitleSaves() {
  if (
    dom.titleDialog instanceof HTMLDialogElement &&
    dom.titleDialog.open &&
    popupState.titleDialogItemKey
  ) {
    await submitTitleDialog();
  }
}

/**
 * Handles dialog form submission.
 *
 * @param {SubmitEvent} event
 */
export async function handleTitleDialogSubmit(event) {
  event.preventDefault();
  await submitTitleDialog();
}

/**
 * Handles clicking the explicit dialog cancel control.
 */
export function handleTitleDialogCancelClick() {
  closeTitleDialog();
}

/**
 * Handles keyboard cancel via the native dialog escape behavior.
 */
export function handleTitleDialogCancelEvent() {
  closeTitleDialog();
}

/**
 * Closes the dialog when the user clicks the backdrop.
 *
 * @param {MouseEvent} event
 */
export function handleTitleDialogClick(event) {
  if (!(dom.titleDialog instanceof HTMLDialogElement)) {
    return;
  }

  if (event.target === dom.titleDialog) {
    closeTitleDialog();
  }
}

async function submitTitleDialog() {
  const itemKey = popupState.titleDialogItemKey;
  if (!itemKey) {
    closeTitleDialog();
    return;
  }

  const dialogValue =
    dom.titleDialogInput instanceof HTMLTextAreaElement ? dom.titleDialogInput.value : "";
  const defaultTitle =
    popupState.titleDialogDefaultTitle ||
    popupState.titleDialogInitialTitle ||
    "video";
  const nextTitle = dialogValue.trim() ? dialogValue.trim() : defaultTitle;

  try {
    await saveTitleOverride(itemKey, nextTitle);
    applyLocalTitleOverride(itemKey, nextTitle);
    closeTitleDialog();
    renderCurrentItems();
    void refreshStatus();
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

async function saveTitleOverride(itemKey, value) {
  if (typeof itemKey !== "string" || !itemKey) {
    return;
  }

  await saveRuntimeTitleOverride(itemKey, value);
}

function closeTitleDialog() {
  if (dom.titleDialog instanceof HTMLDialogElement && dom.titleDialog.open) {
    dom.titleDialog.close();
  }

  popupState.titleDialogItemKey = "";
  popupState.titleDialogDefaultTitle = "";
  popupState.titleDialogInitialTitle = "";

  if (dom.titleDialogForm instanceof HTMLFormElement) {
    dom.titleDialogForm.reset();
  }

  if (dom.titleDialogInput instanceof HTMLTextAreaElement) {
    dom.titleDialogInput.placeholder = "";
  }

  updateAppScrollLock();
}

function findDialogItem(itemKey) {
  return (Array.isArray(popupState.latestRenderState.items)
    ? popupState.latestRenderState.items
    : []
  ).find((item) => getItemKey(item) === itemKey);
}

function applyLocalTitleOverride(itemKey, nextTitle) {
  const nextOverrides = {
    ...(popupState.latestRenderState.titleOverrides &&
    typeof popupState.latestRenderState.titleOverrides === "object"
      ? popupState.latestRenderState.titleOverrides
      : {}),
  };

  const matchingItem = findDialogItem(itemKey);
  const defaultTitle = matchingItem ? getDefaultItemTitle(matchingItem) : "";

  if (!nextTitle || (defaultTitle && nextTitle === defaultTitle)) {
    delete nextOverrides[itemKey];
  } else {
    nextOverrides[itemKey] = nextTitle;
  }

  popupState.latestRenderState.titleOverrides = nextOverrides;

  if (
    popupState.latestRuntimeState &&
    typeof popupState.latestRuntimeState === "object"
  ) {
    popupState.latestRuntimeState = {
      ...popupState.latestRuntimeState,
      titleOverrides: nextOverrides,
    };
  }
}
