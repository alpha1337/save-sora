import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { getSelectedSourceValues } from "../utils/settings.js";

/**
 * Returns whether the picker panel should show character cards instead of results.
 *
 * @param {string} phase
 * @param {object[]} items
 * @returns {boolean}
 */
export function shouldShowCharacterSelectionScreen(phase, items) {
  const selectedSources = getSelectedSourceValues(dom.sourceSelectInputs);
  return (
    selectedSources.includes("characterAccounts") &&
    phase === "idle" &&
    (!Array.isArray(items) || items.length === 0)
  );
}

/**
 * Synchronizes the picker header and optional character grid.
 *
 * @param {string} phase
 * @param {object[]} items
 * @returns {boolean}
 */
export function syncCharacterSelectionScreen(phase, items) {
  const shouldShow = shouldShowCharacterSelectionScreen(phase, items);

  if (dom.pickerPanelLabel instanceof HTMLElement) {
    dom.pickerPanelLabel.textContent = shouldShow ? "Character Selection" : "Search Results";
  }

  if (shouldShow) {
    renderCharacterSelectionGrid();
    return true;
  }

  hideCharacterSelectionGrid();
  return false;
}

export function setCharacterSelectionSummary(accounts = popupState.characterAccounts) {
  if (!(dom.selectionSummary instanceof HTMLElement)) {
    return;
  }

  const normalizedAccounts = normalizeCharacterAccounts(accounts);
  const validIds = new Set(normalizedAccounts.map((account) => account.userId));
  const selectedCount = Array.isArray(popupState.selectedCharacterAccountIds)
    ? popupState.selectedCharacterAccountIds.filter((userId) => validIds.has(userId)).length
    : 0;
  const counterLabel = `${selectedCount} character${selectedCount === 1 ? "" : "s"} selected`;
  dom.selectionSummary.innerHTML = `Who will you choose? <span class="picker-summary-count">${counterLabel}</span>`;
}

function renderCharacterSelectionGrid() {
  if (!(dom.characterSelectionGrid instanceof HTMLElement)) {
    return;
  }

  dom.characterSelectionGrid.classList.remove("hidden");
  dom.itemsList?.classList.add("hidden");
  dom.emptyState?.classList.add("hidden");

  const accounts = normalizeCharacterAccounts(popupState.characterAccounts);
  setCharacterSelectionSummary(accounts);
  const selectedIds = new Set(
    Array.isArray(popupState.selectedCharacterAccountIds)
      ? popupState.selectedCharacterAccountIds
      : [],
  );
  const renderSignature = buildCharacterSelectionSignature(accounts, [...selectedIds]);

  if (popupState.lastCharacterSelectionSignature === renderSignature) {
    return;
  }

  popupState.lastCharacterSelectionSignature = renderSignature;

  if (!accounts.length) {
    dom.characterSelectionGrid.replaceChildren();
    dom.characterSelectionGrid.append(
      createStatusCard(
        popupState.characterAccountsLoading ? "Loading characters..." : "No characters found.",
      ),
    );
    return;
  }

  dom.characterSelectionGrid.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const account of accounts) {
    const selected = selectedIds.has(account.userId);
    const card = document.createElement("article");
    card.className = "character-option-card";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-option-button";
    button.dataset.characterAccountId = account.userId;
    button.setAttribute("aria-pressed", String(selected));
    if (selected) {
      button.classList.add("is-selected");
    }

    const avatar = document.createElement(account.profilePictureUrl ? "img" : "span");
    avatar.className = "character-option-avatar";
    if (avatar instanceof HTMLImageElement) {
      avatar.src = account.profilePictureUrl;
      avatar.alt = `${account.displayName} profile`;
      avatar.decoding = "async";
      avatar.loading = "lazy";
      avatar.referrerPolicy = "no-referrer";
      avatar.addEventListener("load", queueCharacterMarqueeSync, { once: true });
    } else {
      avatar.classList.add("is-fallback");
      avatar.textContent = getAvatarFallback(account.displayName);
    }

    const copy = document.createElement("span");
    copy.className = "character-option-copy";

    const name = createMarqueeLine(
      "strong",
      "character-option-name",
      account.displayName,
    );
    const username = createMarqueeLine(
      "span",
      "character-option-username",
      account.username ? `@${account.username}` : account.userId,
    );

    copy.append(name, username);
    button.append(avatar, copy);
    card.append(button);
    fragment.append(card);
  }

  dom.characterSelectionGrid.append(fragment);
  queueCharacterMarqueeSync();
}

function hideCharacterSelectionGrid() {
  dom.characterSelectionGrid?.classList.add("hidden");
  dom.characterSelectionGrid?.replaceChildren();
  popupState.lastCharacterSelectionSignature = "";
}

function createStatusCard(text) {
  const card = document.createElement("div");
  card.className = "character-option-status";
  card.textContent = text;
  return card;
}

function normalizeCharacterAccounts(accounts) {
  return (Array.isArray(accounts) ? accounts : [])
    .filter(
      (account) =>
        account &&
        typeof account.userId === "string" &&
        account.userId &&
        account.userId.startsWith("ch_"),
    )
    .map((account) => ({
      userId: account.userId,
      username: typeof account.username === "string" ? account.username : "",
      displayName:
        typeof account.displayName === "string" && account.displayName
          ? account.displayName
          : typeof account.username === "string" && account.username
            ? account.username
            : account.userId,
      profilePictureUrl:
        typeof account.profilePictureUrl === "string" && account.profilePictureUrl
          ? account.profilePictureUrl
          : null,
    }));
}

function getAvatarFallback(displayName) {
  return String(displayName || "?")
    .trim()
    .charAt(0)
    .toUpperCase() || "?";
}

function createMarqueeLine(tagName, className, text) {
  const line = document.createElement(tagName);
  line.className = `${className} character-option-marquee`;

  const track = document.createElement("span");
  track.className = "character-option-marquee-track";

  track.append(
    createMarqueeCopy(text, false),
    createMarqueeCopy(text, true),
  );
  line.append(track);
  return line;
}

function queueCharacterMarqueeSync() {
  if (typeof requestAnimationFrame !== "function") {
    syncCharacterMarquees();
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncCharacterMarquees();
    });
  });
}

function syncCharacterMarquees() {
  if (!(dom.characterSelectionGrid instanceof HTMLElement)) {
    return;
  }

  const viewports = dom.characterSelectionGrid.querySelectorAll(".character-option-marquee");
  for (const viewport of viewports) {
    if (!(viewport instanceof HTMLElement)) {
      continue;
    }

    const track = viewport.querySelector(".character-option-marquee-track");
    if (!(track instanceof HTMLElement)) {
      continue;
    }

    const primary = track.querySelector(".character-option-marquee-copy");
    if (!(primary instanceof HTMLElement)) {
      continue;
    }

    const primaryText = primary.querySelector(".character-option-marquee-text");
    if (!(primaryText instanceof HTMLElement)) {
      continue;
    }

    viewport.classList.remove("is-overflowing");
    viewport.style.removeProperty("--marquee-duration");

    const primaryWidth = primaryText.getBoundingClientRect().width;
    const viewportWidth = viewport.getBoundingClientRect().width;
    const overflowDistance = primaryWidth - viewportWidth;
    if (overflowDistance <= 6) {
      continue;
    }

    const gap = 20;
    const segmentWidth = primaryWidth + gap;
    const durationSeconds = Math.max(7, Math.min(18, segmentWidth / 18));
    viewport.classList.add("is-overflowing");
    viewport.style.setProperty("--marquee-gap", `${gap}px`);
    viewport.style.setProperty("--marquee-duration", `${durationSeconds}s`);
  }
}

function createMarqueeCopy(text, ariaHidden) {
  const copy = document.createElement("span");
  copy.className = "character-option-marquee-copy";
  const content = document.createElement("span");
  content.className = "character-option-marquee-text";
  content.textContent = text;
  copy.append(content);
  if (ariaHidden) {
    copy.setAttribute("aria-hidden", "true");
  }
  return copy;
}

function buildCharacterSelectionSignature(accounts, selectedIds) {
  return JSON.stringify({
    loading: Boolean(popupState.characterAccountsLoading),
    selectedIds,
    accounts,
  });
}
