import { dom } from "../dom.js";
import {
  formatSourceSelectionLabel,
  getSelectedSourceValues,
  readCheckedSourceValues,
} from "../utils/settings.js";
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
}

export function handleSettingsSourceMenuChange(event) {
  enforceMinimumSelection(event, "settings");
  handleSettingsChange();
}

export function handleSourceMenuDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Node)) {
    closeAllSourceMenus();
    return;
  }

  if (
    (dom.sourceSelectControl instanceof HTMLElement && dom.sourceSelectControl.contains(target)) ||
    (dom.defaultSourceControl instanceof HTMLElement && dom.defaultSourceControl.contains(target))
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
  for (const groupKey of ["overview", "settings"]) {
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

  return null;
}
