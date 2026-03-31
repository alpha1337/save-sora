import { dom } from "../dom.js";
import { showNotice } from "../ui/layout.js";
import { handleRemoveButtonClick } from "./item-mutations.js";
import { refreshStatus, startPolling, stopPolling } from "./polling.js";
import { updateSelectionFromDom } from "./selection-sync.js";
import {
  isTitleInput,
  queueTitleSave,
  saveTitleOverride,
} from "./title-edits.js";

/**
 * Handles clicks inside the item list.
 *
 * @param {MouseEvent} event
 */
export async function handleItemsListClick(event) {
  const targetElement = getEventTargetElement(event.target);
  if (!(targetElement instanceof Element)) {
    return;
  }

  const removeButton = targetElement.closest(".item-remove-button");
  if (removeButton instanceof HTMLButtonElement) {
    await handleRemoveButtonClick(event, removeButton);
    return;
  }

  if (isIgnoredCardClickTarget(targetElement)) {
    return;
  }

  const card = targetElement.closest(".item-card");
  if (!(card instanceof HTMLElement)) {
    return;
  }

  const checkbox = card.querySelector(".item-checkbox");
  if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) {
    return;
  }

  checkbox.checked = !checkbox.checked;
  await updateSelectionFromDom();
}

/**
 * Handles checkbox changes inside the item list.
 *
 * @param {Event} event
 */
export async function handleItemsListChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
    return;
  }

  await updateSelectionFromDom();
}

/**
 * Handles title input typing inside the item list.
 *
 * @param {Event} event
 */
export function handleItemsListInput(event) {
  const target = event.target;
  if (!isTitleInput(target)) {
    return;
  }

  queueTitleSave(target.dataset.itemKey, target.value);
}

/**
 * Stops polling while a title input is focused.
 *
 * @param {FocusEvent} event
 */
export function handleItemsListFocusIn(event) {
  if (isTitleInput(event.target)) {
    stopPolling();
  }
}

/**
 * Flushes title edits when a title input loses focus.
 *
 * @param {FocusEvent} event
 */
export function handleItemsListFocusOut(event) {
  const target = event.target;
  if (!isTitleInput(target)) {
    return;
  }

  void saveTitleOverride(target.dataset.itemKey, target.value).catch((error) => {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  });

  window.setTimeout(() => {
    if (!isTitleInput(document.activeElement)) {
      startPolling();
      void refreshStatus();
    }
  }, 0);
}

/**
 * Returns whether a click target should not toggle the card checkbox.
 *
 * @param {Element} targetElement
 * @returns {boolean}
 */
function isIgnoredCardClickTarget(targetElement) {
  return Boolean(
    targetElement.closest(".item-title-input") ||
      targetElement.closest(".item-link") ||
      targetElement.closest(".item-metadata-link") ||
      targetElement.closest(".item-media") ||
      targetElement.closest(".item-play-button") ||
      targetElement.closest(".item-video") ||
      targetElement.closest(".item-replay-button"),
  );
}

/**
 * Normalizes the event target so delegated handlers can reason about it safely.
 *
 * @param {EventTarget|null} target
 * @returns {Element|null}
 */
function getEventTargetElement(target) {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node && target.parentElement instanceof Element) {
    return target.parentElement;
  }

  return null;
}
