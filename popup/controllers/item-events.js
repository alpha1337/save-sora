import { handleRemoveButtonClick } from "./item-mutations.js";
import { openTitleDialog } from "./title-edits.js";
import {
  handleItemsListFocusIn as handleVirtualListFocusIn,
  handleItemsListFocusOut as handleVirtualListFocusOut,
  handleItemsListPointerOut as handleVirtualListPointerOut,
  handleItemsListPointerOver as handleVirtualListPointerOver,
  handleSharedGridTooltipPointerEnter as handleVirtualTooltipPointerEnter,
  handleSharedGridTooltipPointerLeave as handleVirtualTooltipPointerLeave,
  scheduleVisibleItemsWindowRender,
  scheduleVirtualListMeasurement,
} from "../ui/list/index.js";

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

  const prompt = targetElement.closest(".item-prompt");
  if (prompt instanceof HTMLElement) {
    togglePromptExpansion(prompt);
    return;
  }

  const titleButton = targetElement.closest(".item-title-button");
  if (titleButton instanceof HTMLButtonElement) {
    openTitleDialog(titleButton.dataset.itemKey || "");
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
}

/**
 * Handles keyboard interaction for inline expandable prompt text.
 *
 * @param {KeyboardEvent} event
 */
export function handleItemsListKeydown(event) {
  const targetElement = getEventTargetElement(event.target);
  if (!(targetElement instanceof HTMLElement) || !targetElement.classList.contains("item-prompt")) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  togglePromptExpansion(targetElement);
}

export function handleItemsListPointerOver(event) {
  handleVirtualListPointerOver(event);
}

export function handleItemsListPointerOut(event) {
  handleVirtualListPointerOut(event);
}

export function handleItemsListFocusIn(event) {
  handleVirtualListFocusIn(event);
}

export function handleItemsListFocusOut(event) {
  handleVirtualListFocusOut(event);
}

export function handleSharedGridTooltipPointerEnter() {
  handleVirtualTooltipPointerEnter();
}

export function handleSharedGridTooltipPointerLeave(event) {
  handleVirtualTooltipPointerLeave(event);
}

export { scheduleVisibleItemsWindowRender };

/**
 * Returns whether a click target should not toggle the card checkbox.
 *
 * @param {Element} targetElement
 * @returns {boolean}
 */
function isIgnoredCardClickTarget(targetElement) {
  return Boolean(
    targetElement.closest(".item-prompt") ||
      targetElement.closest(".item-title-button") ||
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

function togglePromptExpansion(prompt) {
  if (!(prompt instanceof HTMLElement) || !prompt.classList.contains("is-expandable")) {
    return;
  }

  const isExpanded = !prompt.classList.contains("is-expanded");
  prompt.classList.toggle("is-expanded", isExpanded);
  prompt.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  prompt.title = isExpanded ? "Click to collapse description" : "Click to expand description";
  scheduleVirtualListMeasurement();
}
