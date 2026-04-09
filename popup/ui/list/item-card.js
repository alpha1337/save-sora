import { getItemKey } from "../../utils/items.js";
import { renderMediaPreview } from "../media.js";
import { createItemContentSurface } from "./item-card-parts.js";

/**
 * Builds one item card.
 *
 * @param {object} item
 * @param {{
 *   selectedSet: Set<string>,
 *   titleOverrides: Record<string, string>,
 *   disableInputs: boolean,
 *   viewMode: "list"|"grid",
 * }} context
 * @returns {{card: HTMLElement, isSelected: boolean}}
 */
export function createItemCard(item, context) {
  const key = getItemKey(item);
  const isSelected = context.selectedSet.has(key);

  const card = document.createElement("article");
  card.className = "item-card";
  card.classList.toggle("is-selected", isSelected);
  card.classList.toggle("is-removed", Boolean(item.isRemoved));
  card.classList.toggle("is-downloaded", Boolean(item.isDownloaded));
  card.dataset.itemKey = key;
  if (context.viewMode === "grid") {
    card.tabIndex = 0;
  }

  const media = document.createElement("div");
  media.className = "item-media";
  media.dataset.itemKey = key;
  renderMediaPreview(media, item, context.titleOverrides);

  const body = createItemContentSurface(
    item,
    {
      key,
      disableInputs: context.disableInputs,
      titleOverrides: context.titleOverrides,
    },
    context.viewMode === "grid" ? "item-grid-tooltip-surface" : "item-body",
  );

  if (context.viewMode === "grid") {
    const gridOverlay = document.createElement("div");
    gridOverlay.className = "item-grid-overlay";
    gridOverlay.append(body);
    media.append(gridOverlay);
  }

  card.append(media);

  if (context.viewMode !== "grid") {
    card.append(body);
  }

  return { card, isSelected };
}
