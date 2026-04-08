/**
 * Normalization helpers for popup settings and filter form values.
 */

export const AVAILABLE_SOURCE_VALUES = [
  "profile",
  "drafts",
  "likes",
  "characters",
  "characterAccounts",
  "creators",
];

/**
 * Normalizes one or more selected sources, including legacy saved values.
 *
 * @param {string|string[]|null|undefined} value
 * @returns {("profile"|"drafts"|"likes"|"characters"|"characterAccounts"|"creators")[]}
 */
export function normalizeSourceValues(value, fallback = []) {
  const requested = Array.isArray(value) ? value : value == null ? [] : [value];
  const selected = new Set();

  for (const entry of requested) {
    if (entry === "both") {
      selected.add("profile");
      selected.add("drafts");
      continue;
    }

    if (
      entry === "profile" ||
      entry === "drafts" ||
      entry === "likes" ||
      entry === "characters" ||
      entry === "characterAccounts" ||
      entry === "creators"
    ) {
      selected.add(entry);
    }
  }

  const ordered = AVAILABLE_SOURCE_VALUES.filter((entry) => selected.has(entry));
  return ordered.length ? ordered : [...fallback];
}

/**
 * Reads the checked source values from a checkbox group without applying a fallback.
 *
 * @param {Iterable<Element>|ArrayLike<Element>|null|undefined} inputs
 * @returns {("profile"|"drafts"|"likes"|"characters"|"characterAccounts"|"creators")[]}
 */
export function readCheckedSourceValues(inputs) {
  const selected = new Set();

  for (const input of Array.from(inputs || [])) {
    if (!(input instanceof HTMLInputElement) || !input.checked) {
      continue;
    }

    if (
      input.value === "profile" ||
      input.value === "drafts" ||
      input.value === "likes" ||
      input.value === "characters" ||
      input.value === "characterAccounts" ||
      input.value === "creators"
    ) {
      selected.add(input.value);
    }
  }

  return AVAILABLE_SOURCE_VALUES.filter((entry) => selected.has(entry));
}

/**
 * Reads a checkbox group and returns the explicit checked source values.
 *
 * @param {Iterable<Element>|ArrayLike<Element>|null|undefined} inputs
 * @returns {("profile"|"drafts"|"likes"|"characters"|"characterAccounts"|"creators")[]}
 */
export function getSelectedSourceValues(inputs) {
  return normalizeSourceValues(readCheckedSourceValues(inputs));
}

/**
 * Applies a normalized selection to a checkbox group.
 *
 * @param {Iterable<Element>|ArrayLike<Element>|null|undefined} inputs
 * @param {string|string[]|null|undefined} values
 */
export function setSelectedSourceValues(inputs, values) {
  const selected = new Set(normalizeSourceValues(values));

  for (const input of Array.from(inputs || [])) {
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }

    input.checked = selected.has(input.value);
  }
}

/**
 * Serializes source values for cheap equality checks.
 *
 * @param {string|string[]|null|undefined} values
 * @returns {string}
 */
export function serializeSourceValues(values) {
  return normalizeSourceValues(values).join("|");
}

/**
 * Returns the display label for a single source value.
 *
 * @param {"profile"|"drafts"|"likes"|"characters"|"characterAccounts"|"creators"} value
 * @returns {string}
 */
export function getSourceOptionLabel(value) {
  if (value === "profile") {
    return "Published";
  }

  if (value === "drafts") {
    return "Drafts";
  }

  if (value === "likes") {
    return "Likes";
  }

  if (value === "characterAccounts") {
    return "Characters";
  }

  if (value === "creators") {
    return "Creators";
  }

  return "Cameos";
}

/**
 * Builds the compact trigger label for the source multi-select.
 *
 * @param {string|string[]|null|undefined} values
 * @returns {string}
 */
export function formatSourceSelectionLabel(values) {
  const normalized = normalizeSourceValues(values);
  if (normalized.length === 0) {
    return "No sources selected";
  }

  if (normalized.length > 2) {
    return `${getSourceOptionLabel(normalized[0])} +${normalized.length - 1} more`;
  }

  return normalized.map((value) => getSourceOptionLabel(value)).join(" + ");
}

/**
 * Normalizes the current sort mode.
 *
 * @param {string|null|undefined} value
 * @returns {"newest"|"oldest"|"likes"|"views"|"remixes"}
 */
export function normalizeSortValue(value) {
  return value === "oldest" || value === "likes" || value === "views" || value === "remixes"
    ? value
    : "newest";
}

/**
 * Normalizes the current results layout mode.
 *
 * @param {string|null|undefined} value
 * @returns {"list"|"grid"}
 */
export function normalizeResultsViewMode(value) {
  return value === "grid" ? "grid" : "list";
}
