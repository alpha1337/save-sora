import {
  formatCompactCount,
  formatCreatedAt,
  formatFileSize,
  truncatePrompt,
} from "../../utils/format.js";
import {
  getItemSourceLabel,
  isDraftVideoItem,
  isCreatorScopedItem,
  resolveItemTitle,
} from "../../utils/items.js";

/**
 * Creates the editable title row.
 *
 * @param {object} item
 * @param {{key: string, disableInputs: boolean, titleOverrides: Record<string, string>}} context
 * @returns {HTMLDivElement}
 */
export function createTitleRow(item, context) {
  const titleRow = document.createElement("div");
  titleRow.className = "item-title-row";

  const titleEditor = document.createElement("div");
  titleEditor.className = "item-title-editor";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "item-title-input";
  titleInput.value = resolveItemTitle(item, context.titleOverrides);
  titleInput.dataset.itemKey = context.key;
  titleInput.disabled = context.disableInputs;
  titleInput.spellcheck = false;
  titleInput.title = "Click to rename this video";

  const editIcon = document.createElement("span");
  editIcon.className = "item-title-icon";
  editIcon.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M11.9 1.6a1.6 1.6 0 0 1 2.3 2.3l-8 8-3.2.9.9-3.2 8-8Zm-7.1 9.3 1.1 1.1 6.9-6.9-1.1-1.1-6.9 6.9Zm-0.5 0.6-0.4 1.3 1.3-0.4-0.9-0.9Z" fill="currentColor"/></svg>';

  titleEditor.append(titleInput, editIcon);
  titleRow.append(titleEditor);
  return titleRow;
}

/**
 * Creates the metadata row with timestamp and optional state/source badges.
 *
 * @param {object} item
 * @returns {HTMLDivElement}
 */
export function createMetaRow(item) {
  const metaRow = document.createElement("div");
  metaRow.className = "item-meta-row";

  const sourceBadge = createSourceBadge(item);
  if (sourceBadge) {
    metaRow.append(sourceBadge);
  }

  const draftBadge = createDraftBadge(item);
  if (draftBadge) {
    metaRow.append(draftBadge);
  }

  const meta = document.createElement("p");
  meta.className = "item-meta";
  meta.textContent = formatCreatedAt(item.postedAt || item.createdAt) || "No timestamp";
  metaRow.append(meta);

  return metaRow;
}

/**
 * Creates the prompt excerpt shown in each card.
 *
 * @param {object} item
 * @returns {HTMLParagraphElement}
 */
export function createPrompt(item) {
  const prompt = document.createElement("p");
  prompt.className = "item-prompt";
  prompt.textContent = truncatePrompt(item.prompt);
  return prompt;
}

/**
 * Creates the small metric pill row shown beneath the prompt.
 *
 * @param {object} item
 * @returns {HTMLDivElement}
 */
export function createDetailsRow(item) {
  const detailsRow = document.createElement("div");
  detailsRow.className = "item-details-row";

  const repostPill = createCountPill("Reposts", item.repostCount);
  if (repostPill) {
    detailsRow.append(repostPill);
  }

  return detailsRow;
}

/**
 * Creates the footer row with file size and remove/restore button.
 *
 * @param {object} item
 * @param {{key: string, disableInputs: boolean}} context
 * @returns {HTMLDivElement}
 */
export function createFooter(item, context) {
  const footer = document.createElement("div");
  footer.className = "item-footer";

  const fileSize = document.createElement("span");
  fileSize.className = "item-file-size";
  fileSize.textContent = formatFileSize(item.fileSizeBytes) || "";
  fileSize.classList.toggle("hidden", !fileSize.textContent);
  footer.append(fileSize);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "item-remove-button";
  removeButton.classList.toggle("is-restore", Boolean(item.isRemoved));
  removeButton.classList.toggle("is-redownload", Boolean(item.isDownloaded));
  removeButton.dataset.itemKey = context.key;
  removeButton.disabled = context.disableInputs;
  removeButton.textContent = item.isDownloaded
    ? "Download Again"
    : item.isRemoved
      ? "Restore"
      : "Remove from set";
  footer.append(removeButton);

  return footer;
}

/**
 * Creates a badge describing that the item is still in draft state.
 *
 * @param {object} item
 * @returns {HTMLSpanElement|null}
 */
function createDraftBadge(item) {
  if (!isDraftVideoItem(item)) {
    return null;
  }

  const badge = document.createElement("span");
  badge.className = "item-state-badge";
  badge.textContent = "Draft";
  return badge;
}

/**
 * Creates a badge describing the item's source bucket when that extra context matters.
 *
 * @param {object} item
 * @returns {HTMLSpanElement|null}
 */
function createSourceBadge(item) {
  if (!isCreatorScopedItem(item)) {
    return null;
  }

  const badge = document.createElement("span");
  badge.className = "item-source-badge";
  badge.textContent = getItemSourceLabel(item);
  return badge;
}

/**
 * Creates a compact numeric count pill.
 *
 * @param {string} label
 * @param {number|string|null|undefined} value
 * @returns {HTMLSpanElement|null}
 */
function createCountPill(label, value) {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const pill = document.createElement("span");
  pill.className = "item-count-pill";
  pill.textContent = `${label} ${formatCompactCount(numeric)}`;
  return pill;
}
