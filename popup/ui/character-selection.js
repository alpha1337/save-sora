import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { getFetchUiState } from "../utils/runtime-state.js";
import { formatCreatedAt, formatWholeNumber } from "../utils/format.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import { updateAppScrollLock } from "./layout.js";

/**
 * Renders the pre-fetch source picker used for saved creators and character accounts.
 */

export function shouldShowSourceSelectionScreen(phase, items) {
  const selectedSources = getSelectedSourceValues(dom.sourceSelectInputs);
  const shouldShowScopedPicker =
    selectedSources.includes("creators") || selectedSources.includes("characterAccounts");

  const hasItems = Array.isArray(items) && items.length > 0;
  const isBlockedByActiveRun =
    phase === "fetching" || phase === "fetch-paused" || phase === "downloading";

  return shouldShowScopedPicker && !isBlockedByActiveRun && !hasItems;
}

export function syncSourceSelectionScreen(phase, items) {
  const shouldShow = shouldShowSourceSelectionScreen(phase, items);

  if (dom.pickerPanelLabel instanceof HTMLElement) {
    dom.pickerPanelLabel.textContent = shouldShow ? getPickerTitle() : "Search Results";
  }

  if (!shouldShow) {
    hideSelectionScreen();
    return false;
  }

  renderSelectionScreen();
  return true;
}

export function isSourceSelectionScreenVisible() {
  return (
    dom.characterSelectionGrid instanceof HTMLElement &&
    !dom.characterSelectionGrid.classList.contains("hidden")
  );
}

export function openCreatorDetailsDialog(profileId) {
  if (typeof profileId !== "string" || !profileId) {
    return;
  }

  popupState.creatorDetailsProfileId = profileId;
  syncCreatorDetailsDialog();
}

export function closeCreatorDetailsDialog() {
  popupState.creatorDetailsProfileId = "";
  clearCreatorDetailsDialog();

  if (dom.creatorDetailsDialog instanceof HTMLDialogElement && dom.creatorDetailsDialog.open) {
    dom.creatorDetailsDialog.close();
  }

  updateAppScrollLock();
}

export function syncCreatorDetailsDialog() {
  if (!(dom.creatorDetailsDialog instanceof HTMLDialogElement)) {
    return;
  }

  const profile = getCreatorProfileById(popupState.creatorDetailsProfileId);
  if (!profile) {
    closeCreatorDetailsDialog();
    return;
  }

  renderCreatorDetailsDialog(profile);

  if (!dom.creatorDetailsDialog.open) {
    dom.creatorDetailsDialog.showModal();
  }

  queueMarqueeSync();

  updateAppScrollLock();
}

export function setActiveSourceSelectionTab(nextTab) {
  if (typeof nextTab !== "string" || !nextTab) {
    return;
  }

  const sections = buildSections();
  const availableTabs = new Set(sections.map((section) => section.key));
  if (!availableTabs.has(nextTab)) {
    return;
  }

  popupState.activeSourceSelectionTab = nextTab;
  if (dom.pickerScrollRegion instanceof HTMLElement) {
    dom.pickerScrollRegion.scrollTop = 0;
  }
}

export function getSelectionScreenActionState() {
  const sections = buildSections();
  const creators = getSectionByKey(sections, "creators")?.items || [];
  const characters = getSectionByKey(sections, "characterAccounts")?.items || [];
  const selectedCreatorIds = new Set(getSelectedIdsForSection("creators", creators));
  const selectedCharacterIds = new Set(getSelectedIdsForSection("characterAccounts", characters));
  const activeScopeKey = resolveActiveSourceSelectionTab(sections);
  const isTabbed = sections.length > 1;
  const visibleCreatorCount = !isTabbed || activeScopeKey === "creators" ? creators.length : 0;
  const visibleCharacterCount =
    !isTabbed || activeScopeKey === "characterAccounts" ? characters.length : 0;
  const visibleCreatorSelectedCount =
    !isTabbed || activeScopeKey === "creators" ? selectedCreatorIds.size : 0;
  const visibleCharacterSelectedCount =
    !isTabbed || activeScopeKey === "characterAccounts" ? selectedCharacterIds.size : 0;

  return {
    visible: isSourceSelectionScreenVisible(),
    activeScopeKey,
    isTabbed,
    creatorCount: creators.length,
    creatorSelectedCount: selectedCreatorIds.size,
    characterCount: characters.length,
    characterSelectedCount: selectedCharacterIds.size,
    totalCount: creators.length + characters.length,
    selectedCount: selectedCreatorIds.size + selectedCharacterIds.size,
    visibleCount: visibleCreatorCount + visibleCharacterCount,
    visibleSelectedCount: visibleCreatorSelectedCount + visibleCharacterSelectedCount,
  };
}

export function setSourceSelectionSummary() {
  if (!(dom.selectionSummary instanceof HTMLElement)) {
    return;
  }

  const selectedSources = getSelectedSourceValues(dom.sourceSelectInputs);
  const actionState = getSelectionScreenActionState();
  let leadCopy = "Choose which saved sources to include.";

  if (selectedSources.includes("creators") && !selectedSources.includes("characterAccounts")) {
    leadCopy = actionState.creatorCount > 0
      ? "Choose which creators to include."
      : "Add creators to start building a backup list.";
  } else if (selectedSources.includes("characterAccounts") && !selectedSources.includes("creators")) {
    leadCopy = "Who will you choose?";
  }

  dom.selectionSummary.replaceChildren(document.createTextNode(leadCopy));

  if (actionState.isTabbed) {
    return;
  }

  if (selectedSources.includes("creators") && actionState.creatorCount > 0) {
    dom.selectionSummary.append(document.createTextNode(" "));
    dom.selectionSummary.append(
      createSummaryPill(
        `${formatWholeNumber(actionState.creatorSelectedCount)} creator${actionState.creatorSelectedCount === 1 ? "" : "s"} selected`,
      ),
    );
  }

  if (selectedSources.includes("characterAccounts") && actionState.characterCount > 0) {
    dom.selectionSummary.append(document.createTextNode(" "));
    dom.selectionSummary.append(
      createSummaryPill(
        `${formatWholeNumber(actionState.characterSelectedCount)} character${actionState.characterSelectedCount === 1 ? "" : "s"} selected`,
      ),
    );
  }
}

function renderSelectionScreen() {
  if (!(dom.characterSelectionGrid instanceof HTMLElement)) {
    return;
  }

  dom.characterSelectionGrid.classList.remove("hidden");
  dom.itemsList?.classList.add("hidden");
  dom.emptyState?.classList.add("hidden");

  const sections = buildSections();
  const activeTab = resolveActiveSourceSelectionTab(sections);
  const renderSignature = buildSelectionScreenSignature(sections, activeTab);
  const previousScrollTop = dom.pickerScrollRegion instanceof HTMLElement
    ? dom.pickerScrollRegion.scrollTop
    : 0;

  setSourceSelectionSummary();
  syncSelectionActionButtons();
  syncCreatorDetailsDialog();

  if (popupState.lastSelectionScreenSignature === renderSignature) {
    syncSelectionOptionButtonStates();
    return;
  }

  popupState.lastSelectionScreenSignature = renderSignature;
  dom.characterSelectionGrid.replaceChildren();

  if (sections.length === 0) {
    restoreScroll(previousScrollTop);
    return;
  }

  const fragment = document.createDocumentFragment();
  const isTabbed = sections.length > 1;
  const visibleSections = isTabbed
    ? sections.filter((section) => section.key === activeTab)
    : sections;

  if (isTabbed) {
    fragment.append(createSelectionTabs(sections, activeTab));
  }

  for (const section of visibleSections) {
    fragment.append(createSection(section, { showHeader: !isTabbed }));
  }

  dom.characterSelectionGrid.append(fragment);
  syncSelectionOptionButtonStates();
  restoreScroll(previousScrollTop);
  queueMarqueeSync();
}

function hideSelectionScreen() {
  dom.characterSelectionGrid?.classList.add("hidden");
  dom.characterSelectionGrid?.replaceChildren();
  popupState.lastSelectionScreenSignature = "";
  popupState.activeSourceSelectionTab = "";
  popupState.openCreatorActionMenuId = "";
  closeCreatorDetailsDialog();
}

function buildSections() {
  const selectedSources = getSelectedSourceValues(dom.sourceSelectInputs);
  const sections = [];

  if (selectedSources.includes("creators")) {
    sections.push({
      key: "creators",
      title: "Creators",
      subtitle: "Save specific public creator profiles for future fetches.",
      items: normalizeCreatorProfiles(popupState.creatorProfiles),
    });
  }

  if (selectedSources.includes("characterAccounts")) {
    sections.push({
      key: "characterAccounts",
      title: "Characters",
      subtitle: "Select the characters you want to include in this fetch.",
      items: normalizeCharacterAccounts(popupState.characterAccounts),
      loading: popupState.characterAccountsLoading === true,
    });
  }

  return sections;
}

function createSection(section, { showHeader = false } = {}) {
  const element = document.createElement("section");
  element.className = "selection-section";
  element.dataset.selectionSection = section.key;

  if (showHeader) {
    const header = document.createElement("div");
    header.className = "selection-section-header";

    const title = document.createElement("h3");
    title.className = "selection-section-title";
    title.textContent = section.title;

    const subtitle = document.createElement("p");
    subtitle.className = "selection-section-subtitle";
    subtitle.textContent = section.subtitle;

    header.append(title, subtitle);
    element.append(header);
  }

  if (section.key === "creators") {
    const grid = document.createElement("div");
    grid.className = "selection-option-grid";

    for (const profile of section.items) {
      grid.append(createCreatorCard(profile));
    }
    grid.append(createAddCreatorCard());

    element.append(grid);
    return element;
  }

  const grid = document.createElement("div");
  grid.className = "selection-option-grid";

  if (section.items.length > 0) {
    for (const account of section.items) {
      grid.append(createCharacterCard(account));
    }
  } else {
    grid.append(createStatusCard(section.loading ? "Loading characters..." : "No characters found."));
  }

  element.append(grid);
  return element;
}

function createSelectionTabs(sections, activeTab) {
  const tabList = document.createElement("div");
  tabList.className = "source-selection-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Saved source types");

  for (const section of sections) {
    const count = getSelectedCountForSection(section.key, section.items);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-selection-tab";
    button.dataset.sourceSelectionTab = section.key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(section.key === activeTab));
    if (section.key === activeTab) {
      button.classList.add("is-active");
    }
    button.textContent = `${section.title} (${formatWholeNumber(count)})`;
    tabList.append(button);
  }

  return tabList;
}

function createCharacterCard(account) {
  const selectedIds = new Set(
    normalizeSelectedIds(
      normalizeCharacterAccounts(popupState.characterAccounts).map((item) => item.userId),
      popupState.selectedCharacterAccountIds,
    ),
  );
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

  button.append(createAvatarNode(account.displayName, account.profilePictureUrl));
  button.append(
    createCopyBlock(
      account.displayName,
      account.username ? `@${account.username}` : account.userId,
    ),
  );

  card.append(button);
  return card;
}

function createCreatorCard(profile) {
  const selectedIds = new Set(
    normalizeSelectedIds(
      normalizeCreatorProfiles(popupState.creatorProfiles).map((item) => item.profileId),
      popupState.selectedCreatorProfileIds,
    ),
  );
  const selected = selectedIds.has(profile.profileId);

  const card = document.createElement("article");
  card.className = "character-option-card creator-option-card";

  const actionMenu = createCreatorActionMenu(profile);
  const actionButton = document.createElement("button");
  actionButton.type = "button";
  actionButton.className = "selection-option-menu-button creator-option-settings-button";
  actionButton.dataset.creatorMenuId = profile.profileId;
  actionButton.setAttribute("aria-label", `Open settings for ${profile.displayName}`);
  actionButton.setAttribute("aria-haspopup", "menu");
  actionButton.setAttribute("aria-expanded", "false");
  actionButton.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path><circle cx="9" cy="6" r="2"></circle><circle cx="15" cy="12" r="2"></circle><circle cx="11" cy="18" r="2"></circle></svg>';

  const button = document.createElement("button");
  button.type = "button";
  button.className = "character-option-button";
  button.dataset.creatorProfileId = profile.profileId;
  button.setAttribute("aria-pressed", String(selected));
  if (selected) {
    button.classList.add("is-selected");
  }

  const displayName =
    typeof profile.displayName === "string" && profile.displayName
      ? profile.displayName
      : typeof profile.username === "string" && profile.username
        ? profile.username
        : "Saved creator";
  const username = getCreatorCardSubtitle(profile);

  button.append(createAvatarNode(displayName, profile.profilePictureUrl));
  button.append(createCopyBlock(displayName, username));
  card.append(button, actionButton, actionMenu);
  return card;
}

function createCreatorActionMenu(profile) {
  const menu = document.createElement("div");
  menu.className = "selection-option-popover hidden";
  menu.dataset.creatorMenuFor = profile.profileId;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${profile.displayName}`);

  const detailsAction = document.createElement("button");
  detailsAction.type = "button";
  detailsAction.className = "selection-option-popover-action";
  detailsAction.dataset.creatorMenuAction = "details";
  detailsAction.dataset.creatorProfileId = profile.profileId;
  detailsAction.setAttribute("role", "menuitem");
  detailsAction.textContent = "View details";

  const deleteAction = document.createElement("button");
  deleteAction.type = "button";
  deleteAction.className = "selection-option-popover-action is-destructive";
  deleteAction.dataset.creatorMenuAction = "delete";
  deleteAction.dataset.creatorProfileId = profile.profileId;
  deleteAction.setAttribute("role", "menuitem");
  deleteAction.textContent = "Delete creator";

  menu.append(detailsAction, deleteAction);
  return menu;
}

function createAddCreatorCard() {
  const card = document.createElement("article");
  card.className = "character-option-card creator-option-card";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "character-option-button creator-add-button";
  button.dataset.creatorAction = "add";
  button.setAttribute("aria-label", "Add creator");

  const badge = document.createElement("span");
  badge.className = "creator-add-badge";
  badge.textContent = "Quick add";

  const title = document.createElement("strong");
  title.className = "creator-add-title";
  title.textContent = "Add Creator";

  const icon = document.createElement("span");
  icon.className = "creator-add-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "+";

  const hint = document.createElement("span");
  hint.className = "creator-add-hint";
  hint.textContent = "Paste one or more Sora profile links to build your backup list.";

  button.append(badge, icon, title, hint);
  card.append(button);
  return card;
}

function createAvatarNode(displayName, avatarUrl, circular = false) {
  const avatar = document.createElement(avatarUrl ? "img" : "span");
  avatar.className = "character-option-avatar";
  if (circular) {
    avatar.classList.add("is-circular");
  }

  if (avatar instanceof HTMLImageElement) {
    avatar.src = avatarUrl;
    avatar.alt = `${displayName} profile`;
    avatar.decoding = "async";
    avatar.loading = "lazy";
    avatar.referrerPolicy = "no-referrer";
    avatar.addEventListener("load", queueMarqueeSync, { once: true });
    avatar.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = avatar.className;
      fallback.classList.add("is-fallback");
      fallback.textContent = getAvatarFallback(displayName);
      avatar.replaceWith(fallback);
    }, { once: true });
  } else {
    avatar.classList.add("is-fallback");
    avatar.textContent = getAvatarFallback(displayName);
  }

  return avatar;
}

function createCopyBlock(titleText, subtitleText, creatorVariant = false) {
  const copy = document.createElement("span");
  copy.className = "character-option-copy";
  if (creatorVariant) {
    copy.classList.add("creator-option-copy");
  }

  copy.append(createMarqueeLine("strong", "character-option-name", titleText));
  copy.append(createMarqueeLine("span", "character-option-username", subtitleText));
  return copy;
}

function createStatusCard(text) {
  const card = document.createElement("div");
  card.className = "character-option-status";
  card.textContent = text;
  return card;
}

function createSummaryPill(text) {
  const pill = document.createElement("span");
  pill.className = "picker-summary-count";
  pill.textContent = text;
  return pill;
}

function syncSelectionActionButtons() {
  const actionState = getSelectionScreenActionState();
  const shouldShow = actionState.visible && actionState.visibleCount > 0;
  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const isDisabled =
    fetchUiState.isBusy || fetchUiState.isAnyPaused || popupState.characterAccountsLoading;

  if (dom.selectAllButton instanceof HTMLButtonElement) {
    dom.selectAllButton.classList.toggle("hidden", !shouldShow);
    dom.selectAllButton.disabled =
      isDisabled ||
      actionState.visibleCount === 0 ||
      actionState.visibleSelectedCount >= actionState.visibleCount;
    dom.selectAllButton.textContent = "Select All";
  }

  if (dom.clearSelectionButton instanceof HTMLButtonElement) {
    dom.clearSelectionButton.classList.toggle("hidden", !shouldShow);
    dom.clearSelectionButton.disabled = isDisabled || actionState.visibleSelectedCount === 0;
    dom.clearSelectionButton.textContent = "Select None";
  }
}

function syncSelectionOptionButtonStates() {
  if (!(dom.characterSelectionGrid instanceof HTMLElement)) {
    return;
  }

  const selectedCharacterIds = new Set(
    normalizeSelectedIds(
      normalizeCharacterAccounts(popupState.characterAccounts).map((item) => item.userId),
      popupState.selectedCharacterAccountIds,
    ),
  );
  const selectedCreatorIds = new Set(
    normalizeSelectedIds(
      normalizeCreatorProfiles(popupState.creatorProfiles).map((item) => item.profileId),
      popupState.selectedCreatorProfileIds,
    ),
  );
  const openCreatorMenuId =
    typeof popupState.openCreatorActionMenuId === "string"
      ? popupState.openCreatorActionMenuId
      : "";

  const buttons = dom.characterSelectionGrid.querySelectorAll(".character-option-button");
  for (const button of buttons) {
    if (!(button instanceof HTMLButtonElement)) {
      continue;
    }

    if (button.dataset.creatorAction === "add") {
      continue;
    }

    const characterId = button.dataset.characterAccountId || "";
    const creatorId = button.dataset.creatorProfileId || "";
    const isSelected = creatorId
      ? selectedCreatorIds.has(creatorId)
      : selectedCharacterIds.has(characterId);

    button.setAttribute("aria-pressed", String(isSelected));
    button.classList.toggle("is-selected", isSelected);
  }

  const menuButtons = dom.characterSelectionGrid.querySelectorAll("[data-creator-menu-id]");
  for (const menuButton of menuButtons) {
    if (!(menuButton instanceof HTMLButtonElement)) {
      continue;
    }

    const creatorMenuId =
      typeof menuButton.dataset.creatorMenuId === "string" ? menuButton.dataset.creatorMenuId : "";
    const isOpen = creatorMenuId !== "" && creatorMenuId === openCreatorMenuId;
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.classList.toggle("is-open", isOpen);
  }

  const actionMenus = dom.characterSelectionGrid.querySelectorAll("[data-creator-menu-for]");
  for (const actionMenu of actionMenus) {
    if (!(actionMenu instanceof HTMLElement)) {
      continue;
    }

    const creatorMenuId =
      typeof actionMenu.dataset.creatorMenuFor === "string" ? actionMenu.dataset.creatorMenuFor : "";
    const isOpen = creatorMenuId !== "" && creatorMenuId === openCreatorMenuId;
    actionMenu.classList.toggle("hidden", !isOpen);
  }
}

function restoreScroll(scrollTop) {
  if (dom.pickerScrollRegion instanceof HTMLElement) {
    dom.pickerScrollRegion.scrollTop = scrollTop;
  }
}

function getPickerTitle() {
  const selectedSources = getSelectedSourceValues(dom.sourceSelectInputs);
  if (selectedSources.includes("creators") && selectedSources.includes("characterAccounts")) {
    return "Source Selection";
  }

  return selectedSources.includes("creators") ? "Creator Selection" : "Character Selection";
}

function normalizeCharacterAccounts(accounts) {
  const normalized = [];

  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!account || typeof account.userId !== "string" || !account.userId.startsWith("ch_")) {
      continue;
    }

    normalized.push({
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
    });
  }

  return normalized;
}

function normalizeCreatorProfiles(profiles) {
  const normalized = [];

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (
      !profile ||
      typeof profile.profileId !== "string" ||
      !profile.profileId ||
      typeof profile.userId !== "string" ||
      !/^user-[A-Za-z0-9_-]+$/.test(profile.userId)
    ) {
      continue;
    }

    const profileData =
      profile.profileData && typeof profile.profileData === "object"
        ? profile.profileData
        : null;
    const characterUserId =
      typeof profile.characterUserId === "string" && profile.characterUserId.startsWith("ch_")
        ? profile.characterUserId
        : typeof profileData?.user_id === "string" && profileData.user_id.startsWith("ch_")
          ? profileData.user_id
          : typeof profileData?.userId === "string" && profileData.userId.startsWith("ch_")
            ? profileData.userId
            : "";
    const defaultPreferences = {
      includeOfficialPosts: true,
      includeCommunityPosts: true,
    };
    const hasCustomFetchPreferences = profile.hasCustomFetchPreferences === true;
    const hasExplicitOfficialPreference = typeof profile.includeOfficialPosts === "boolean";
    const hasExplicitCommunityPreference = typeof profile.includeCommunityPosts === "boolean";
    const useLegacyPreferenceMigration =
      !hasCustomFetchPreferences &&
      hasExplicitOfficialPreference &&
      hasExplicitCommunityPreference &&
      ((profile.includeOfficialPosts === true && profile.includeCommunityPosts === false) ||
        (profile.includeOfficialPosts === false && profile.includeCommunityPosts === true));

    normalized.push({
      profileId: profile.profileId,
      userId: typeof profile.userId === "string" ? profile.userId : "",
      characterUserId,
      username: typeof profile.username === "string" ? profile.username : "",
      displayName:
        typeof profileData?.display_name === "string" && profileData.display_name
          ? profileData.display_name
          : typeof profile.displayName === "string" && profile.displayName
          ? profile.displayName
          : typeof profile.username === "string" && profile.username
            ? profile.username
            : profile.profileId,
      profilePictureUrl:
        typeof profile.profilePictureUrl === "string" && profile.profilePictureUrl
          ? profile.profilePictureUrl
          : null,
      permalink:
        typeof profile.permalink === "string" && profile.permalink
          ? profile.permalink
          : null,
      profileFetchedAt:
        typeof profile.profileFetchedAt === "string" && profile.profileFetchedAt
          ? profile.profileFetchedAt
          : null,
      profileData:
        profile.profileData && typeof profile.profileData === "object"
          ? profile.profileData
          : null,
      hasCustomFetchPreferences,
      includeOfficialPosts:
        useLegacyPreferenceMigration
          ? defaultPreferences.includeOfficialPosts
          : typeof profile.includeOfficialPosts === "boolean"
          ? profile.includeOfficialPosts
          : defaultPreferences.includeOfficialPosts,
      includeCommunityPosts:
        useLegacyPreferenceMigration
          ? defaultPreferences.includeCommunityPosts
          : typeof profile.includeCommunityPosts === "boolean"
          ? profile.includeCommunityPosts
          : defaultPreferences.includeCommunityPosts,
    });
  }

  return normalized;
}

function isCreatorCharacterProfile(profile) {
  return Boolean(
    profile &&
      typeof profile.characterUserId === "string" &&
      profile.characterUserId.startsWith("ch_"),
  );
}

export function getCreatorProfileById(profileId) {
  if (typeof profileId !== "string" || !profileId) {
    return null;
  }

  return normalizeCreatorProfiles(popupState.creatorProfiles).find(
    (profile) => profile.profileId === profileId,
  ) || null;
}

function getCreatorCardSubtitle(profile) {
  if (profile && typeof profile.username === "string" && profile.username) {
    return `@${profile.username}`;
  }

  if (profile && typeof profile.userId === "string" && profile.userId) {
    return profile.userId;
  }

  return "Saved creator";
}

function buildSelectionScreenSignature(sections, activeTab = "") {
  return JSON.stringify(
    {
      activeTab,
      sections: (Array.isArray(sections) ? sections : []).map((section) => ({
      key: section && section.key ? section.key : "",
      loading: Boolean(section && section.loading),
      items: (section && Array.isArray(section.items) ? section.items : []).map((item) => ({
        id: item && (item.profileId || item.userId) ? item.profileId || item.userId : "",
        userId: item && typeof item.userId === "string" ? item.userId : "",
        characterUserId: item && typeof item.characterUserId === "string" ? item.characterUserId : "",
        username: item && typeof item.username === "string" ? item.username : "",
        displayName: item && typeof item.displayName === "string" ? item.displayName : "",
        profilePictureUrl:
          item && typeof item.profilePictureUrl === "string" ? item.profilePictureUrl : "",
        permalink: item && typeof item.permalink === "string" ? item.permalink : "",
      })),
      })),
    },
  );
}

function resolveActiveSourceSelectionTab(sections) {
  const availableKeys = (Array.isArray(sections) ? sections : [])
    .map((section) => section && section.key)
    .filter((key) => typeof key === "string" && key);
  const selectedKey =
    typeof popupState.activeSourceSelectionTab === "string"
      ? popupState.activeSourceSelectionTab
      : "";

  if (selectedKey && availableKeys.includes(selectedKey)) {
    return selectedKey;
  }

  const fallbackKey = availableKeys[0] || "";
  popupState.activeSourceSelectionTab = fallbackKey;
  return fallbackKey;
}

function getSectionByKey(sections, key) {
  return (Array.isArray(sections) ? sections : []).find((section) => section && section.key === key) || null;
}

function getSelectedIdsForSection(sectionKey, items) {
  if (sectionKey === "creators") {
    return normalizeSelectedIds(
      (Array.isArray(items) ? items : []).map((profile) => profile.profileId),
      popupState.selectedCreatorProfileIds,
    );
  }

  if (sectionKey === "characterAccounts") {
    return normalizeSelectedIds(
      (Array.isArray(items) ? items : []).map((account) => account.userId),
      popupState.selectedCharacterAccountIds,
    );
  }

  return [];
}

function getSelectedCountForSection(sectionKey, items) {
  return getSelectedIdsForSection(sectionKey, items).length;
}

function clearCreatorDetailsDialog() {
  popupState.creatorDetailsHeroSignature = "";

  if (dom.creatorDetailsSummary instanceof HTMLElement) {
    dom.creatorDetailsSummary.textContent = "";
  }

  if (dom.creatorDetailsProfile instanceof HTMLElement) {
    dom.creatorDetailsProfile.replaceChildren();
  }

  if (dom.creatorDetailsStats instanceof HTMLElement) {
    dom.creatorDetailsStats.replaceChildren();
  }

  if (dom.creatorDetailsPreferences instanceof HTMLElement) {
    dom.creatorDetailsPreferences.replaceChildren();
  }

  if (dom.creatorDetailsCode instanceof HTMLElement) {
    dom.creatorDetailsCode.textContent = "";
  }
}

function renderCreatorDetailsDialog(profile) {
  const profileData =
    profile && profile.profileData && typeof profile.profileData === "object"
      ? profile.profileData
      : null;
  const usernameValue =
    typeof profile.username === "string" && profile.username ? profile.username : "";
  const displayNameValue =
    typeof profileData?.display_name === "string" && profileData.display_name
      ? profileData.display_name
      : typeof profileData?.displayName === "string" && profileData.displayName
        ? profileData.displayName
        : typeof profile.displayName === "string" && profile.displayName
          ? profile.displayName
          : usernameValue || "Saved creator";
  const username = usernameValue ? `@${usernameValue}` : "Saved creator";
  const joinedSoraSummary = formatJoinedSoraSummary(profileData && profileData.created_at);
  const lastUpdatedSummary = formatLastUpdatedSummary(profileData && profileData.updated_at);

  if (dom.creatorDetailsDialog instanceof HTMLDialogElement) {
    dom.creatorDetailsDialog.setAttribute("aria-label", `${displayNameValue} profile`);
  }

  if (dom.creatorDetailsTitle instanceof HTMLElement) {
    dom.creatorDetailsTitle.textContent = displayNameValue;
  }

  if (dom.creatorDetailsSummary instanceof HTMLElement) {
    dom.creatorDetailsSummary.textContent = "";
  }

  if (dom.creatorDetailsProfile instanceof HTMLElement) {
    const heroSignature = JSON.stringify({
      profileId: profile.profileId,
      displayNameValue,
      usernameValue,
      joinedSoraSummary,
      lastUpdatedSummary,
      profilePictureUrl: profile.profilePictureUrl || "",
    });

    if (popupState.creatorDetailsHeroSignature !== heroSignature) {
      popupState.creatorDetailsHeroSignature = heroSignature;

      const fragment = document.createDocumentFragment();
      const avatarShell = document.createElement("div");
      avatarShell.className = "creator-details-avatar-shell";
      avatarShell.append(createAvatarNode(displayNameValue || "Creator", profile.profilePictureUrl));

      const body = document.createElement("div");
      body.className = "creator-details-profile-body";

      const displayName = createMarqueeLine(
        "p",
        "creator-details-display-name",
        usernameValue ? username : displayNameValue,
      );
      const identitySummary = document.createElement("div");
      identitySummary.className = "creator-details-identity-summary";

      if (joinedSoraSummary) {
        const joinedLine = document.createElement("p");
        joinedLine.className = "creator-details-identity-line";
        joinedLine.textContent = `${capitalizeSentence(joinedSoraSummary)}.`;
        identitySummary.append(joinedLine);
      }

      if (lastUpdatedSummary) {
        const updateLine = document.createElement("p");
        updateLine.className = "creator-details-identity-line";
        updateLine.textContent = `Last update was ${lastUpdatedSummary}.`;
        identitySummary.append(updateLine);
      }

      body.append(displayName);
      if (identitySummary.childElementCount > 0) {
        body.append(identitySummary);
      }
      fragment.append(avatarShell, body);
      if (dom.creatorDetailsStats instanceof HTMLElement) {
        fragment.append(dom.creatorDetailsStats);
      }
      dom.creatorDetailsProfile.replaceChildren(fragment);
    }
  }

  if (dom.creatorDetailsStats instanceof HTMLElement) {
    const fragment = document.createDocumentFragment();
    const postsValue = isCreatorCharacterProfile(profile)
      ? pickFirstCountValue([
        profileData && profileData.cameo_count,
        profileData && profileData.cameoCount,
        profileData && profileData.post_count,
        profileData && profileData.postCount,
      ])
      : pickFirstCountValue([
        profileData && profileData.post_count,
        profileData && profileData.postCount,
      ]);
    const stats = [
      ["Posts", postsValue],
      ["Cameos", pickFirstCountValue([profileData && profileData.cameo_count])],
      ["Remixes", pickFirstCountValue([profileData && profileData.remix_count])],
      ["Likes", pickFirstCountValue([profileData && profileData.likes_received_count])],
      ["Followers", pickFirstCountValue([profileData && profileData.follower_count])],
      ["Following", pickFirstCountValue([profileData && profileData.following_count])],
    ];

    for (const [label, rawValue] of stats) {
      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        continue;
      }
      const value = formatCountValue(rawValue);

      const stat = document.createElement("article");
      stat.className = "creator-details-stat";

      const statLabel = document.createElement("span");
      statLabel.className = "creator-details-stat-label";
      statLabel.textContent = label;

      const statValue = document.createElement("strong");
      statValue.className = "creator-details-stat-value";
      statValue.textContent = value;

      stat.append(statLabel, statValue);
      fragment.append(stat);
    }

    dom.creatorDetailsStats.replaceChildren(fragment);
  }

  if (dom.creatorDetailsPreferences instanceof HTMLElement) {
    const preferencesSection = document.createDocumentFragment();
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Fetch Preferences";

    const list = document.createElement("div");
    list.className = "creator-details-preferences-list";

    const isSavingPreference = popupState.creatorPreferenceSavingProfileId === profile.profileId;
    const fetchUiState = getFetchUiState(
      popupState.latestRuntimeState,
      popupState.latestRenderState,
    );
    const options = [
      {
        key: "includeOfficialPosts",
        title: "Official posts",
        checked: profile.includeOfficialPosts === true,
      },
      {
        key: "includeCommunityPosts",
        title: "Community posts",
        checked: profile.includeCommunityPosts === true,
      },
    ];

    for (const option of options) {
      const optionLabel = document.createElement("label");
      optionLabel.className = "creator-details-preference-option";

      const optionCopy = document.createElement("div");
      optionCopy.className = "creator-details-preference-copy";

      const optionTitle = document.createElement("span");
      optionTitle.className = "creator-details-preference-title";
      optionTitle.textContent = option.title;

      const optionStatus = document.createElement("span");
      optionStatus.className = `creator-details-preference-status ${option.checked ? "is-enabled" : "is-disabled"}`;
      optionStatus.textContent = option.checked ? "Enabled" : "Disabled";
      optionStatus.setAttribute("aria-live", "polite");

      optionCopy.append(optionTitle, optionStatus);

      const switchWrap = document.createElement("span");
      switchWrap.className = "creator-details-switch";

      const input = document.createElement("input");
      input.className = "creator-details-switch-input";
      input.type = "checkbox";
      input.checked = option.checked;
      input.disabled = isSavingPreference || fetchUiState.isBusy || fetchUiState.isAnyPaused;
      input.dataset.creatorProfileId = profile.profileId;
      input.dataset.creatorPreferenceKey = option.key;
      input.setAttribute("aria-label", `${option.title}: ${option.checked ? "enabled" : "disabled"}`);

      const track = document.createElement("span");
      track.className = "creator-details-switch-track";

      const thumb = document.createElement("span");
      thumb.className = "creator-details-switch-thumb";
      track.append(thumb);

      switchWrap.append(input, track);
      optionLabel.append(optionCopy, switchWrap);
      list.append(optionLabel);
    }

    preferencesSection.append(label, list);
    dom.creatorDetailsPreferences.replaceChildren(preferencesSection);
  }
}

function formatCountValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatWholeNumber(numeric) : "";
}

function pickFirstCountValue(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return null;
}

function formatDateValue(value) {
  return formatCreatedAt(value) || "";
}

function formatAccountAge(value) {
  if (value == null || value === "") {
    return "";
  }

  const createdAtMs =
    typeof value === "number"
      ? value < 1e12
        ? value * 1000
        : value
      : new Date(value).getTime();

  if (!Number.isFinite(createdAtMs)) {
    return "";
  }

  const elapsedMs = Math.max(0, Date.now() - createdAtMs);
  const dayMs = 1000 * 60 * 60 * 24;
  const days = Math.floor(elapsedMs / dayMs);

  if (days < 1) {
    return "Joined today";
  }

  if (days < 30) {
    return `${formatWholeNumber(days)} day${days === 1 ? "" : "s"} on Sora`;
  }

  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `${formatWholeNumber(months)} month${months === 1 ? "" : "s"} on Sora`;
  }

  const years = Math.floor(days / 365);
  const remainderMonths = Math.floor((days % 365) / 30);
  if (remainderMonths <= 0) {
    return `${formatWholeNumber(years)} year${years === 1 ? "" : "s"} on Sora`;
  }

  return `${formatWholeNumber(years)}y ${formatWholeNumber(remainderMonths)}m on Sora`;
}

function formatJoinedSoraSummary(value) {
  if (value == null || value === "") {
    return "";
  }

  const createdAtMs =
    typeof value === "number"
      ? value < 1e12
        ? value * 1000
        : value
      : new Date(value).getTime();

  if (!Number.isFinite(createdAtMs)) {
    return "";
  }

  const elapsedMs = Math.max(0, Date.now() - createdAtMs);
  const dayMs = 1000 * 60 * 60 * 24;
  const days = Math.floor(elapsedMs / dayMs);

  if (days < 1) {
    return "joined Sora today";
  }

  if (days < 30) {
    return `joined Sora ${formatWholeNumber(days)} day${days === 1 ? "" : "s"} ago`;
  }

  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `joined Sora ${formatWholeNumber(months)} month${months === 1 ? "" : "s"} ago`;
  }

  const years = Math.floor(days / 365);
  return `joined Sora ${formatWholeNumber(years)} year${years === 1 ? "" : "s"} ago`;
}

function formatLastUpdatedSummary(value) {
  if (value == null || value === "") {
    return "";
  }

  const updatedAtMs =
    typeof value === "number"
      ? value < 1e12
        ? value * 1000
        : value
      : new Date(value).getTime();

  if (!Number.isFinite(updatedAtMs)) {
    return "";
  }

  const elapsedMs = Math.max(0, Date.now() - updatedAtMs);
  const minuteMs = 1000 * 60;
  const hourMs = minuteMs * 60;
  const dayMs = hourMs * 24;
  const weekMs = dayMs * 7;

  if (elapsedMs < minuteMs) {
    return "just now";
  }

  if (elapsedMs < hourMs) {
    const minutes = Math.max(1, Math.floor(elapsedMs / minuteMs));
    return `${formatWholeNumber(minutes)} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (elapsedMs < dayMs) {
    const hours = Math.max(1, Math.floor(elapsedMs / hourMs));
    return `${formatWholeNumber(hours)} hour${hours === 1 ? "" : "s"} ago`;
  }

  if (elapsedMs < weekMs) {
    const days = Math.max(1, Math.floor(elapsedMs / dayMs));
    return `${formatWholeNumber(days)} day${days === 1 ? "" : "s"} ago`;
  }

  if (elapsedMs < weekMs * 2) {
    return "last week";
  }

  return formatDateValue(value);
}

function capitalizeSentence(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }

  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function normalizeSelectedIds(validIds, selectedIds) {
  const validIdSet = new Set(Array.isArray(validIds) ? validIds : []);
  const normalized = [];

  for (const value of Array.isArray(selectedIds) ? selectedIds : []) {
    if (typeof value !== "string" || !validIdSet.has(value) || normalized.includes(value)) {
      continue;
    }
    normalized.push(value);
  }

  return normalized;
}

function getAvatarFallback(displayName) {
  return String(displayName || "?").trim().charAt(0).toUpperCase() || "?";
}

function createMarqueeLine(tagName, className, text) {
  const line = document.createElement(tagName);
  line.className = `${className} character-option-marquee`;

  const track = document.createElement("span");
  track.className = "character-option-marquee-track";
  track.append(createMarqueeCopy(text, false));
  track.append(createMarqueeCopy(text, true));
  line.append(track);
  return line;
}

function queueMarqueeSync() {
  if (typeof requestAnimationFrame !== "function") {
    syncMarquees();
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncMarquees();
    });
  });
}

function syncMarquees() {
  if (typeof document === "undefined") {
    return;
  }

  const viewports = document.querySelectorAll(".character-option-marquee");
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
    if (primaryWidth - viewportWidth <= 6) {
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
