import { dom } from "../dom.js";
import {
  addCreatorProfiles,
  removeCreatorProfile,
  requestCharacterAccounts,
  saveCharacterSelection,
  saveCreatorSelection,
} from "../runtime.js";
import { popupState } from "../state.js";
import {
  formatSourceSelectionLabel,
  getSelectedSourceValues,
} from "../utils/settings.js";
import { hideNotice, showNotice, updateAppScrollLock } from "../ui/layout.js";
import { renderCurrentItems } from "../ui/render.js";
import { handleSettingsChange } from "./settings.js";
import {
  closeCreatorDetailsDialog,
  getSelectionScreenActionState,
  openCreatorDetailsDialog,
  setActiveSourceSelectionTab,
} from "../ui/character-selection.js";

/**
 * Handles the custom source menus plus the pre-fetch creator/character picker.
 */

export function handleOverviewSourceTriggerClick() {
  toggleSourceMenu("overview");
}

export function handleSettingsSourceTriggerClick() {
  toggleSourceMenu("settings");
}

export function handleOverviewSourceMenuChange(event) {
  popupState.hasCustomOverviewSourceSelection = true;
  updateSourceMenuLabel("overview");

  if (getSelectedSourceValues(dom.sourceSelectInputs).includes("characterAccounts")) {
    void ensureCharacterAccountsLoaded();
  } else {
    syncCharacterMenu();
  }

  popupState.lastRenderedSignature = "";
  renderCurrentItems();
}

export function handleSettingsSourceMenuChange(event) {
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
  void applyCharacterSelection(selectedIds);
}

export function handleCharacterSelectionClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const tabButton = target.closest("[data-source-selection-tab]");
  if (tabButton instanceof HTMLButtonElement) {
    event.preventDefault();
    const nextTab =
      typeof tabButton.dataset.sourceSelectionTab === "string"
        ? tabButton.dataset.sourceSelectionTab
        : "";
    if (nextTab) {
      setActiveSourceSelectionTab(nextTab);
      popupState.lastRenderedSignature = "";
      renderCurrentItems();
    }
    return;
  }

  const addButton = target.closest("[data-creator-action='add']");
  if (addButton instanceof HTMLButtonElement) {
    event.preventDefault();
    closeCreatorActionMenu();
    openCreatorDialog();
    return;
  }

  const actionButton = target.closest("[data-creator-menu-action]");
  if (actionButton instanceof HTMLButtonElement) {
    event.preventDefault();
    const creatorProfileId =
      typeof actionButton.dataset.creatorProfileId === "string"
        ? actionButton.dataset.creatorProfileId
        : "";
    const action =
      typeof actionButton.dataset.creatorMenuAction === "string"
        ? actionButton.dataset.creatorMenuAction
        : "";
    if (creatorProfileId && action === "details") {
      closeCreatorActionMenu();
      openCreatorDetailsDialog(creatorProfileId);
      return;
    }

    closeCreatorActionMenu(false);

    if (creatorProfileId && action === "delete") {
      void handleCreatorRemoval(creatorProfileId);
    }
    return;
  }

  const menuButton = target.closest("[data-creator-menu-id]");
  if (menuButton instanceof HTMLButtonElement) {
    event.preventDefault();
    const creatorProfileId =
      typeof menuButton.dataset.creatorMenuId === "string"
        ? menuButton.dataset.creatorMenuId
        : "";
    if (creatorProfileId) {
      toggleCreatorActionMenu(creatorProfileId);
    }
    return;
  }

  const button = target.closest(".character-option-button");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  event.preventDefault();
  closeCreatorActionMenu(false);

  const creatorProfileId =
    typeof button.dataset.creatorProfileId === "string" ? button.dataset.creatorProfileId : "";
  if (creatorProfileId) {
    void toggleCreatorSelection(creatorProfileId);
    return;
  }

  const characterId =
    typeof button.dataset.characterAccountId === "string" ? button.dataset.characterAccountId : "";
  if (characterId) {
    void toggleCharacterSelection(characterId);
  }
}

export async function selectAllVisibleSourceScopes() {
  const { activeScopeKey } = getSelectionScreenActionState();
  const tasks = [];

  if (!activeScopeKey || activeScopeKey === "creators") {
    tasks.push(
      applyCreatorSelection(
        normalizeCreatorProfiles(popupState.creatorProfiles).map((profile) => profile.profileId),
      ),
    );
  }

  if (!activeScopeKey || activeScopeKey === "characterAccounts") {
    tasks.push(
      applyCharacterSelection(
        normalizeCharacterAccounts(popupState.characterAccounts).map((account) => account.userId),
      ),
    );
  }

  await Promise.all(tasks);
}

export async function clearVisibleSourceScopes() {
  const { activeScopeKey } = getSelectionScreenActionState();
  const tasks = [];

  if (!activeScopeKey || activeScopeKey === "creators") {
    tasks.push(applyCreatorSelection([]));
  }

  if (!activeScopeKey || activeScopeKey === "characterAccounts") {
    tasks.push(applyCharacterSelection([]));
  }

  await Promise.all(tasks);
}

export async function selectAllCharacterAccounts() {
  await applyCharacterSelection(
    normalizeCharacterAccounts(popupState.characterAccounts).map((account) => account.userId),
  );
}

export async function clearCharacterAccountsSelection() {
  await applyCharacterSelection([]);
}

export function handleCreatorDialogCancelClick() {
  closeCreatorDialog();
}

export function handleCreatorDialogCancelEvent() {
  closeCreatorDialog();
}

export function handleCreatorDetailsCloseClick() {
  closeCreatorDetailsDialog();
}

export function handleCreatorDetailsCancelEvent() {
  closeCreatorDetailsDialog();
}

export function handleCreatorDialogSubmit(event) {
  event.preventDefault();
  void submitCreatorDialog();
}

export function handleSourceMenuDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Node)) {
    closeAllSourceMenus();
    return;
  }

  if (
    target instanceof Element &&
    (target.closest("[data-creator-menu-id]") || target.closest(".selection-option-popover"))
  ) {
    return;
  }

  if (
    (dom.sourceSelectControl instanceof HTMLElement && dom.sourceSelectControl.contains(target)) ||
    (dom.defaultSourceControl instanceof HTMLElement && dom.defaultSourceControl.contains(target)) ||
    (dom.characterSelectControl instanceof HTMLElement && dom.characterSelectControl.contains(target)) ||
    (dom.creatorDialog instanceof HTMLDialogElement && dom.creatorDialog.contains(target))
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
  const closedCreatorActionMenu = closeCreatorActionMenu(false);

  for (const groupKey of ["overview", "settings", "characterAccounts"]) {
    const group = getSourceMenuGroup(groupKey);
    if (!group || !(group.button instanceof HTMLButtonElement) || !(group.menu instanceof HTMLElement)) {
      continue;
    }

    group.button.setAttribute("aria-expanded", "false");
    group.control?.classList.remove("is-open");
    group.menu.classList.add("hidden");
  }

  if (closedCreatorActionMenu) {
    renderCurrentItems();
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

function toggleCreatorActionMenu(creatorProfileId) {
  const validIds = normalizeCreatorProfiles(popupState.creatorProfiles).map(
    (profile) => profile.profileId,
  );
  if (!validIds.includes(creatorProfileId)) {
    return;
  }

  popupState.openCreatorActionMenuId =
    popupState.openCreatorActionMenuId === creatorProfileId ? "" : creatorProfileId;
  renderCurrentItems();
}

function closeCreatorActionMenu(shouldRender = true) {
  if (!popupState.openCreatorActionMenuId) {
    return false;
  }

  popupState.openCreatorActionMenuId = "";
  if (shouldRender) {
    renderCurrentItems();
  }
  return true;
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
      profilePictureUrl:
        typeof account.profilePictureUrl === "string" && account.profilePictureUrl
          ? account.profilePictureUrl
          : null,
    }));
}

function normalizeCreatorProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .filter(
      (profile) =>
        profile &&
        typeof profile.profileId === "string" &&
        profile.profileId &&
        typeof profile.userId === "string" &&
        /^user-[A-Za-z0-9_-]+$/.test(profile.userId),
    )
    .map((profile) => ({
      profileId: profile.profileId,
      userId: typeof profile.userId === "string" ? profile.userId : "",
      username: typeof profile.username === "string" ? profile.username : "",
      displayName:
        typeof profile.displayName === "string" && profile.displayName
          ? profile.displayName
          : typeof profile.username === "string" && profile.username
            ? profile.username
            : profile.profileId,
      profilePictureUrl:
        typeof profile.profilePictureUrl === "string" && profile.profilePictureUrl
          ? profile.profilePictureUrl
          : null,
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
  const inputs = dom.characterSelectInputs;

  if (!inputs.length) {
    return getSelectedCharacterIds();
  }

  for (const input of inputs) {
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

  return [];
}

function getSelectedCharacterIds() {
  return Array.isArray(popupState.selectedCharacterAccountIds)
    ? popupState.selectedCharacterAccountIds.filter((value) => typeof value === "string" && value)
    : [];
}

function getSelectedCreatorIds() {
  return Array.isArray(popupState.selectedCreatorProfileIds)
    ? popupState.selectedCreatorProfileIds.filter((value) => typeof value === "string" && value)
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

  if (!selectedIds.length) {
    dom.characterSelectLabel.textContent = "No characters selected";
    return;
  }

  if (selectedIds.length === accounts.length) {
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

async function toggleCharacterSelection(characterId) {
  const validIds = normalizeCharacterAccounts(popupState.characterAccounts).map(
    (account) => account.userId,
  );
  if (!validIds.includes(characterId)) {
    return;
  }

  const selectedSet = new Set(getSelectedCharacterIds());
  if (selectedSet.has(characterId)) {
    selectedSet.delete(characterId);
  } else {
    selectedSet.add(characterId);
  }

  await applyCharacterSelection(validIds.filter((value) => selectedSet.has(value)));
}

async function toggleCreatorSelection(creatorProfileId) {
  const validIds = normalizeCreatorProfiles(popupState.creatorProfiles).map(
    (profile) => profile.profileId,
  );
  if (!validIds.includes(creatorProfileId)) {
    return;
  }

  const selectedSet = new Set(getSelectedCreatorIds());
  if (selectedSet.has(creatorProfileId)) {
    selectedSet.delete(creatorProfileId);
  } else {
    selectedSet.add(creatorProfileId);
  }

  await applyCreatorSelection(validIds.filter((value) => selectedSet.has(value)));
}

async function applyCharacterSelection(selectedIds) {
  popupState.selectedCharacterAccountIds = normalizeRequestedCharacterAccountIds(selectedIds);
  updateCharacterMenuLabel();
  renderCurrentItems();

  try {
    await saveCharacterSelection(popupState.selectedCharacterAccountIds);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

async function applyCreatorSelection(selectedIds) {
  popupState.selectedCreatorProfileIds = normalizeRequestedCreatorProfileIds(selectedIds);
  renderCurrentItems();

  try {
    await saveCreatorSelection(popupState.selectedCreatorProfileIds);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

function normalizeRequestedCharacterAccountIds(selectedIds) {
  const validIds = normalizeCharacterAccounts(popupState.characterAccounts).map(
    (account) => account.userId,
  );
  const selectedSet = new Set(
    (Array.isArray(selectedIds) ? selectedIds : []).filter((value) => typeof value === "string" && value),
  );
  return validIds.filter((value) => selectedSet.has(value));
}

function normalizeRequestedCreatorProfileIds(selectedIds) {
  const validIds = normalizeCreatorProfiles(popupState.creatorProfiles).map(
    (profile) => profile.profileId,
  );
  const selectedSet = new Set(
    (Array.isArray(selectedIds) ? selectedIds : []).filter((value) => typeof value === "string" && value),
  );
  return validIds.filter((value) => selectedSet.has(value));
}

function openCreatorDialog() {
  if (!(dom.creatorDialog instanceof HTMLDialogElement)) {
    return;
  }

  hideNotice(dom.creatorDialogError);
  if (dom.creatorDialogForm instanceof HTMLFormElement) {
    dom.creatorDialogForm.reset();
  }
  popupState.creatorDialogSubmitting = false;
  updateCreatorDialogSubmitState();

  if (!dom.creatorDialog.open) {
    dom.creatorDialog.showModal();
  }

  updateAppScrollLock();

  if (dom.creatorDialogInput instanceof HTMLTextAreaElement) {
    dom.creatorDialogInput.focus();
  }
}

function closeCreatorDialog() {
  if (!(dom.creatorDialog instanceof HTMLDialogElement)) {
    return;
  }

  if (dom.creatorDialog.open) {
    dom.creatorDialog.close();
  }

  updateAppScrollLock();

  if (dom.creatorDialogForm instanceof HTMLFormElement) {
    dom.creatorDialogForm.reset();
  }
  hideNotice(dom.creatorDialogError);
  popupState.creatorDialogSubmitting = false;
  updateCreatorDialogSubmitState();
}

async function submitCreatorDialog() {
  if (popupState.creatorDialogSubmitting) {
    return;
  }

  const profileUrls = parseCreatorProfileUrls(
    dom.creatorDialogInput instanceof HTMLTextAreaElement
      ? dom.creatorDialogInput.value
      : "",
  );

  if (!profileUrls.length) {
    showNotice(dom.creatorDialogError, "Paste at least one Sora creator username or profile link.");
    return;
  }

  popupState.creatorDialogSubmitting = true;
  updateCreatorDialogSubmitState();
  hideNotice(dom.creatorDialogError);
  hideNotice(dom.warningBox);
  hideNotice(dom.errorBox);

  try {
    const response = await addCreatorProfiles(profileUrls);
    popupState.creatorProfiles = Array.isArray(response.state && response.state.creatorProfiles)
      ? response.state.creatorProfiles
      : popupState.creatorProfiles;
    popupState.selectedCreatorProfileIds = Array.isArray(
      response.state && response.state.selectedCreatorProfileIds,
    )
      ? response.state.selectedCreatorProfileIds
      : popupState.selectedCreatorProfileIds;
    closeCreatorDialog();
    renderCurrentItems();

    if (Array.isArray(response.failures) && response.failures.length > 0) {
      const failurePreview = response.failures
        .slice(0, 2)
        .map((failure) => failure.profileUrl)
        .filter(Boolean)
        .join(", ");
      showNotice(
        dom.warningBox,
        response.failures.length === 1
          ? `Added the creator list, but 1 creator entry could not be read: ${failurePreview}`
          : `Added the creator list, but ${response.failures.length} creator entries could not be read.${failurePreview ? ` Problem entries included ${failurePreview}.` : ""}`,
      );
    }
  } catch (error) {
    showNotice(dom.creatorDialogError, error instanceof Error ? error.message : String(error));
  } finally {
    popupState.creatorDialogSubmitting = false;
    updateCreatorDialogSubmitState();
  }
}

async function handleCreatorRemoval(creatorProfileId) {
  closeCreatorActionMenu(false);
  if (popupState.creatorDetailsProfileId === creatorProfileId) {
    closeCreatorDetailsDialog();
  }

  hideNotice(dom.errorBox);

  try {
    const response = await removeCreatorProfile(creatorProfileId);
    popupState.creatorProfiles = Array.isArray(response.state && response.state.creatorProfiles)
      ? response.state.creatorProfiles
      : popupState.creatorProfiles.filter((profile) => profile.profileId !== creatorProfileId);
    popupState.selectedCreatorProfileIds = Array.isArray(
      response.state && response.state.selectedCreatorProfileIds,
    )
      ? response.state.selectedCreatorProfileIds
      : popupState.selectedCreatorProfileIds.filter((profileId) => profileId !== creatorProfileId);
    renderCurrentItems();
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

function updateCreatorDialogSubmitState() {
  if (dom.creatorDialogSubmit instanceof HTMLButtonElement) {
    dom.creatorDialogSubmit.disabled = popupState.creatorDialogSubmitting;
    dom.creatorDialogSubmit.textContent = popupState.creatorDialogSubmitting
      ? "Adding creators..."
      : "Add Creator";
  }

  if (dom.creatorDialogCancel instanceof HTMLButtonElement) {
    dom.creatorDialogCancel.disabled = popupState.creatorDialogSubmitting;
  }

  if (dom.creatorDialogInput instanceof HTMLTextAreaElement) {
    dom.creatorDialogInput.disabled = popupState.creatorDialogSubmitting;
  }
}

function parseCreatorProfileUrls(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return [];
  }

  const extractedUrls = rawValue.match(/https?:\/\/[^\s,]+/g);
  const candidates = extractedUrls && extractedUrls.length
    ? extractedUrls
    : rawValue.split(/[\r\n,]+/g);

  return [...new Set(
    candidates
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}
