import {
  formatCompactCount,
  formatCreatedAt,
  formatFileSize,
  truncatePrompt,
} from "../../utils/format.js";
import {
  getDefaultItemTitle,
  getItemSourceLabel,
  isCreatorScopedItem,
  resolveItemTitle,
} from "../../utils/items.js";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarIcon,
  HardDriveDownloadIcon,
  createLucideIcon,
} from "../../../vendor/lucide.js";

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

  const resolvedTitle = resolveItemTitle(item, context.titleOverrides);
  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "item-title-shell item-title-button";
  titleButton.dataset.itemKey = context.key;
  titleButton.dataset.defaultTitle = getDefaultItemTitle(item);
  titleButton.title = "Click to rename this video";
  titleButton.setAttribute("aria-label", `Rename title: ${resolvedTitle}`);

  const titleText = document.createElement("span");
  titleText.className = "item-title-text";
  titleText.textContent = resolvedTitle;

  titleButton.append(titleText);
  titleEditor.append(titleButton);
  titleRow.append(titleEditor);

  if (!item.isDownloaded) {
    titleRow.append(createArchiveToggle(item, context));
  }

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

  const metaIcon = document.createElement("span");
  metaIcon.className = "item-meta-icon";
  metaIcon.append(
    createLucideIcon(CalendarIcon, {
      className: "lucide lucide-calendar",
      size: 13,
    }),
  );
  metaRow.append(metaIcon);

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
  const promptText = truncatePrompt(item.prompt);
  prompt.textContent = promptText;

  if (promptText && promptText !== "No prompt text available." && promptText.length > 120) {
    prompt.classList.add("is-expandable");
    prompt.setAttribute("role", "button");
    prompt.setAttribute("tabindex", "0");
    prompt.setAttribute("aria-expanded", "false");
    prompt.title = "Click to expand description";
  }

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
  const fileSizeText = formatFileSize(item.fileSizeBytes) || "";
  if (fileSizeText) {
    const fileSizeIcon = document.createElement("span");
    fileSizeIcon.className = "item-file-size-icon";
    fileSizeIcon.append(
      createLucideIcon(HardDriveDownloadIcon, {
        className: "lucide lucide-hard-drive-download",
        size: 13,
      }),
    );

    const fileSizeLabel = document.createElement("span");
    fileSizeLabel.textContent = fileSizeText;
    fileSize.append(fileSizeIcon, fileSizeLabel);
  }
  fileSize.classList.toggle("hidden", !fileSizeText);
  footer.append(fileSize);

  if (item.isDownloaded) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "item-remove-button is-redownload";
    removeButton.dataset.itemKey = context.key;
    removeButton.disabled = context.disableInputs;
    removeButton.textContent = "Download Again";
    removeButton.setAttribute("aria-label", "Download again");
    removeButton.title = "Download again";
    footer.append(removeButton);
  }

  return footer;
}

/**
 * Creates the shared textual content surface for an item card.
 *
 * List and grid modes should render the same item content once and only change
 * how that content is presented.
 *
 * @param {object} item
 * @param {{key: string, disableInputs: boolean, titleOverrides: Record<string, string>}} context
 * @param {string} className
 * @returns {HTMLDivElement}
 */
export function createItemContentSurface(item, context, className) {
  const surface = document.createElement("div");
  surface.className = className;

  surface.append(
    createTitleRow(item, context),
    createMetaRow(item),
    createPrompt(item),
  );

  const detailsRow = createDetailsRow(item);
  if (detailsRow.childElementCount > 0) {
    surface.append(detailsRow);
  }

  surface.append(createFooter(item, context));
  return surface;
}

function createArchiveToggle(item, context) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "item-remove-button item-title-toggle";
  button.classList.toggle("is-restore", Boolean(item.isRemoved));
  button.classList.add("is-icon-only");
  button.dataset.itemKey = context.key;
  button.disabled = context.disableInputs;

  const icon = document.createElement("span");
  icon.className = "item-remove-button-icon";
  icon.append(
    createLucideIcon(item.isRemoved ? ArchiveRestoreIcon : ArchiveIcon, {
      className: item.isRemoved
        ? "lucide lucide-archive-restore"
        : "lucide lucide-archive",
      size: 15,
    }),
  );

  const label = document.createElement("span");
  label.className = "visually-hidden";
  label.textContent = item.isRemoved ? "Restore from archive" : "Archive video";

  button.append(icon, label);
  button.setAttribute("aria-label", label.textContent);
  button.title = label.textContent;
  return button;
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
