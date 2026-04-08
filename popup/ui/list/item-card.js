import { getItemKey } from "../../utils/items.js";
import { matchesSmartSearch } from "../../utils/search.js";
import { renderMediaPreview } from "../media.js";
import {
  createFooter,
  createGridTooltip,
  createMetaRow,
  createPrompt,
  createTitleRow,
  createDetailsRow,
} from "./item-card-parts.js";

/**
 * Builds one item card.
 *
 * @param {object} item
 * @param {{
 *   selectedSet: Set<string>,
 *   titleOverrides: Record<string, string>,
 *   disableInputs: boolean,
 *   query: string,
 * }} context
 * @returns {{card: HTMLElement, matchesQuery: boolean, isSelected: boolean}}
 */
export function createItemCard(item, context) {
  const key = getItemKey(item);
  const isSelected = context.selectedSet.has(key);
  const matchesQuery = matchesSmartSearch(item, context.titleOverrides, context.query);

  const card = document.createElement("article");
  card.className = "item-card";
  card.classList.toggle("is-selected", isSelected);
  card.classList.toggle("is-removed", Boolean(item.isRemoved));
  card.classList.toggle("is-downloaded", Boolean(item.isDownloaded));
  card.classList.toggle("hidden", !matchesQuery);
  card.dataset.itemKey = key;

  const media = document.createElement("div");
  media.className = "item-media";
  media.dataset.itemKey = key;
  renderMediaPreview(media, item, context.titleOverrides);

  const body = createItemBody(item, {
    key,
    disableInputs: context.disableInputs,
    titleOverrides: context.titleOverrides,
  });

  const gridTooltip = createGridTooltip(item, {
    key,
    disableInputs: context.disableInputs,
    titleOverrides: context.titleOverrides,
  });

  card.append(media, body, gridTooltip);
  return { card, matchesQuery, isSelected };
}

/**
 * Creates the textual body of an item card.
 *
 * @param {object} item
 * @param {{key: string, disableInputs: boolean, titleOverrides: Record<string, string>}} context
 * @returns {HTMLDivElement}
 */
function createItemBody(item, context) {
  const body = document.createElement("div");
  body.className = "item-body";

  const bodyChildren = [
    createTitleRow(item, context),
    createMetaRow(item),
    createPrompt(item),
  ];

  const detailsRow = createDetailsRow(item);
  if (detailsRow.childElementCount > 0) {
    bodyChildren.push(detailsRow);
  }

  bodyChildren.push(createFooter(item, context));
  body.append(...bodyChildren);
  return body;
}
