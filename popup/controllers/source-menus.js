import { dom } from "../dom.js";
import { requestCharacterAccounts, saveCharacterSelection } from "../runtime.js";
import { popupState } from "../state.js";
import {
  formatSourceSelectionLabel,
  getSelectedSourceValues,
  readCheckedSourceValues,
} from "../utils/settings.js";
import { showNotice } from "../ui/layout.js";
import { renderCurrentItems } from "../ui/render.js";
import { handleSettingsChange } from "./settings.js";

/**
 * Handles the custom multi-select source menus used in Overview and Settings.
 */

export function handleOverviewSourceTriggerClick() {
  toggleSourceMenu("overview");
}

export function handleSettingsSourceTriggerClick() {
  toggleSourceMenu("settings");
}

export function handleOverviewSourceMenuChange(event) {
  enforceMinimumSelection(event, "overview");
  if (getSelectedSourceValues(dom.sourceSelectInputs).includes("characterAccounts")) {
    void ensureCharacterAccountsLoaded();
  } else {
    syncCharacterMenu();
  }

  popupState.lastRenderedSignature = "";
  renderCurrentItems();
}

export function handleSettingsSourceMenuChange(event) {
  enforceMinimumSelection(event, "settings");
  handleSettingsChange();
}

export function handleCharacterMenuTriggerClick() {
  if (!popupState.characterAccounts.length && !popupState.characterAccountsLoading) {
    void ensureCharacterAccountsLoaded();
  }
  toggleSourceMenu("characterAccounts");
}

export function handleCharacterMenuChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
    return;
  }

  const selectedIds = readCheckedCharacterValues();
  if (!selectedIds.length) {
    target.checked = true;
    updateCharacterMenuLabel();
    return;
  }

  popupState.selectedCharacterAccountIds = selectedIds;
  updateCharacterMenuLabel();
  popupState.lastRenderedSignature = "";
  renderCurrentItems();
  void saveCharacterSelection(selectedIds).catch((error) => {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  });
}

export function handleCharacterSelectionClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest(".character-option-button");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  event.preventDefault();

  const characterId = typeof button.dataset.characterAccountId === "string"
    ? button.dataset.characterAccountId
    : "";
  if (!characterId) {
    return;
  }

  const validIds = normalizeCharacterAccounts(popupState.characterAccounts).map(
    (account) => account.userId,
  );
  if (!validIds.includes(characterId)) {
    return;
  }

  const selectedSet = new Set(getSelectedCharacterIds());
  if (selectedSet.has(characterId)) {
    if (selectedSet.size <= 1) {
      return;
    }
    selectedSet.delete(characterId);
  } else {
    selectedSet.add(characterId);
  }

  const selectedIds = validIds.filter((value) => selectedSet.has(value));
  popupState.selectedCharacterAccountIds = selectedIds;
  updateCharacterMenuLabel();
  popupState.lastRenderedSignature = "";
  renderCurrentItems();
  void saveCharacterSelection(selectedIds).catch((error) => {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  });
}

export function handleSourceMenuDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Node)) {
    closeAllSourceMenus();
    return;
  }

  if (
    (dom.sourceSelectControl instanceof HTMLElement && dom.sourceSelectControl.contains(target)) ||
    (dom.defaultSourceControl instanceof HTMLElement && dom.defaultSourceControl.contains(target)) ||
    (dom.characterSelectControl instanceof HTMLElement && dom.characterSelectControl.contains(target))
  ) {
    return;
  }

  closeAllSourceMenus();
}

export function handleSourceMenuDocumentKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  closeAllSourceMenus();
}

export function closeAllSourceMenus() {
  for (const groupKey of ["overview", "settings", "characterAccounts"]) {
    const group = getSourceMenuGroup(groupKey);
    if (!group || !(group.button instanceof HTMLButtonElement) || !(group.menu instanceof HTMLElement)) {
      continue;
    }

    group.button.setAttribute("aria-expanded", "false");
    group.control?.classList.remove("is-open");
    group.menu.classList.add("hidden");
  }
}

export function syncSourceMenuLabels() {
  updateSourceMenuLabel("overview");
  updateSourceMenuLabel("settings");
}

export function syncCharacterMenu() {
  const shouldShow = getSelectedSourceValues(dom.sourceSelectInputs).includes("characterAccounts");
  const accounts = normalizeCharacterAccounts(popupState.characterAccounts);

  if (dom.characterSelectField instanceof HTMLElement) {
    dom.characterSelectField.classList.add("hidden");
  }

  if (!shouldShow) {
    closeCharacterMenu();
    return;
  }

  renderCharacterMenuOptions(accounts);
  updateCharacterMenuLabel();

  if (dom.characterSelectButton instanceof HTMLButtonElement) {
    const isDisabled = popupState.latestBusy || popupState.characterAccountsLoading;
    dom.characterSelectButton.disabled = isDisabled;
  }

  if (
    !accounts.length &&
    !popupState.characterAccountsLoading &&
    !popupState.latestBusy &&
    !popupState.hasAttemptedCharacterAccountLoad
  ) {
    void ensureCharacterAccountsLoaded();
  }
}

function toggleSourceMenu(groupKey) {
  const group = getSourceMenuGroup(groupKey);
  if (!group || !(group.button instanceof HTMLButtonElement) || group.button.disabled) {
    return;
  }

  const shouldOpen = group.button.getAttribute("aria-expanded") !== "true";
  closeAllSourceMenus();

  if (!shouldOpen || !(group.menu instanceof HTMLElement)) {
    return;
  }

  group.button.setAttribute("aria-expanded", "true");
  group.control?.classList.add("is-open");
  group.menu.classList.remove("hidden");
}

function enforceMinimumSelection(event, groupKey) {
  const target = event.target;
  const group = getSourceMenuGroup(groupKey);
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !group) {
    return;
  }

  const selected = readCheckedSourceValues(group.inputs);
  if (!selected.length) {
    target.checked = true;
  }

  updateSourceMenuLabel(groupKey);
}

function updateSourceMenuLabel(groupKey) {
  const group = getSourceMenuGroup(groupKey);
  if (!group || !(group.label instanceof HTMLElement)) {
    return;
  }

  group.label.textContent = formatSourceSelectionLabel(getSelectedSourceValues(group.inputs));
}

function getSourceMenuGroup(groupKey) {
  if (groupKey === "overview") {
    return {
      control: dom.sourceSelectControl,
      button: dom.sourceSelectButton,
      label: dom.sourceSelectLabel,
      menu: dom.sourceSelectMenu,
      inputs: dom.sourceSelectInputs,
    };
  }

  if (groupKey === "settings") {
    return {
      control: dom.defaultSourceControl,
      button: dom.defaultSourceButton,
      label: dom.defaultSourceLabel,
      menu: dom.defaultSourceMenu,
      inputs: dom.defaultSourceInputs,
    };
  }

  if (groupKey === "characterAccounts") {
    return {
      control: dom.characterSelectControl,
      button: dom.characterSelectButton,
      label: dom.characterSelectLabel,
      menu: dom.characterSelectMenu,
      inputs: dom.characterSelectInputs,
    };
  }

  return null;
}

function closeCharacterMenu() {
  const group = getSourceMenuGroup("characterAccounts");
  if (!group || !(group.button instanceof HTMLButtonElement) || !(group.menu instanceof HTMLElement)) {
    return;
  }

  group.button.setAttribute("aria-expanded", "false");
  group.control?.classList.remove("is-open");
  group.menu.classList.add("hidden");
}

async function ensureCharacterAccountsLoaded(force = false) {
  if (popupState.characterAccountsLoading || popupState.latestBusy || popupState.latestPaused) {
    return;
  }

  popupState.characterAccountsLoading = true;
  popupState.hasAttemptedCharacterAccountLoad = true;
  syncCharacterMenu();

  try {
    const response = await requestCharacterAccounts(force);
    popupState.characterAccounts = normalizeCharacterAccounts(
      response.state && Array.isArray(response.state.characterAccounts)
        ? response.state.characterAccounts
        : response.characterAccounts,
    );
    popupState.selectedCharacterAccountIds = Array.isArray(
      response.state && response.state.selectedCharacterAccountIds,
    )
      ? response.state.selectedCharacterAccountIds
      : Array.isArray(response.selectedCharacterAccountIds)
        ? response.selectedCharacterAccountIds
        : popupState.selectedCharacterAccountIds;
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    popupState.characterAccountsLoading = false;
    syncCharacterMenu();
    popupState.lastRenderedSignature = "";
    renderCurrentItems();
  }
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
      cameoCount: Number.isFinite(Number(account.cameoCount)) ? Number(account.cameoCount) : 0,
    }));
}

function renderCharacterMenuOptions(accounts) {
  if (!(dom.characterSelectMenu instanceof HTMLElement)) {
    return;
  }

  const selectedIdSet = new Set(
    Array.isArray(popupState.selectedCharacterAccountIds)
      ? popupState.selectedCharacterAccountIds
      : [],
  );

  dom.characterSelectMenu.replaceChildren();

  if (!accounts.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "multi-select-option";
    emptyState.textContent = popupState.characterAccountsLoading
      ? "Loading character accounts..."
      : "No character accounts found.";
    dom.characterSelectMenu.append(emptyState);
    return;
  }

  for (const account of accounts) {
    const label = document.createElement("label");
    label.className = "multi-select-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = account.userId;
    input.dataset.sourceGroup = "characters";
    input.checked = selectedIdSet.has(account.userId);

    const text = document.createElement("span");
    text.textContent = account.username
      ? `${account.displayName} (@${account.username})`
      : account.displayName;

    label.append(input, text);
    dom.characterSelectMenu.append(label);
  }
}

function readCheckedCharacterValues() {
  const domSelected = [];

  const selected = [];

  for (const input of dom.characterSelectInputs) {
    if (!(input instanceof HTMLInputElement) || !input.checked) {
      continue;
    }

    if (typeof input.value === "string" && input.value) {
      domSelected.push(input.value);
    }
  }

  if (domSelected.length) {
    return domSelected;
  }

  const validIds = new Set(
    normalizeCharacterAccounts(popupState.characterAccounts).map((account) => account.userId),
  );
  for (const value of getSelectedCharacterIds()) {
    if (validIds.has(value) && !selected.includes(value)) {
      selected.push(value);
    }
  }

  return selected;
}

function getSelectedCharacterIds() {
  return Array.isArray(popupState.selectedCharacterAccountIds)
    ? popupState.selectedCharacterAccountIds.filter((value) => typeof value === "string" && value)
    : [];
}

function updateCharacterMenuLabel() {
  if (!(dom.characterSelectLabel instanceof HTMLElement)) {
    return;
  }

  const accounts = normalizeCharacterAccounts(popupState.characterAccounts);
  const selectedIds = readCheckedCharacterValues();

  if (popupState.characterAccountsLoading && !accounts.length) {
    dom.characterSelectLabel.textContent = "Loading characters...";
    return;
  }

  if (!accounts.length) {
    dom.characterSelectLabel.textContent = popupState.hasAttemptedCharacterAccountLoad
      ? "No character accounts found"
      : "Load character accounts";
    return;
  }

  if (!selectedIds.length || selectedIds.length === accounts.length) {
    dom.characterSelectLabel.textContent = "All characters";
    return;
  }

  if (selectedIds.length === 1) {
    const matchingAccount = accounts.find((account) => account.userId === selectedIds[0]);
    dom.characterSelectLabel.textContent = matchingAccount
      ? matchingAccount.displayName
      : "1 character";
    return;
  }

  dom.characterSelectLabel.textContent = `${selectedIds.length} characters`;
}
