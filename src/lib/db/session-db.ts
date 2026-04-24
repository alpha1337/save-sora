import type { AppSettings, CreatorProfile, DownloadQueueItem } from "types/domain";
import { SAVED_ACCOUNTS_STORE, SETTINGS_STORE, openSaveSoraV3Db } from "./save-sora-v3-db";

const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS: AppSettings = {
  archive_name_template: "save-sora-library",
  download_directory_name: "",
  retry_failed_watermark_removals: false,
  enable_fetch_resume: false,
  remember_fetch_date_choice: false,
  remembered_date_range_preset: "all",
  remembered_custom_date_start: "",
  remembered_custom_date_end: ""
};

export interface PersistedSessionState {
  creator_profiles: CreatorProfile[];
  selected_character_account_ids: string[];
  user?: SavedUserSession[];
}

export interface SavedUserSession {
  user_id: string;
  username: string;
  profile_picture_url: string | null;
  plan_type: string | null;
  permalink: string;
  can_cameo: boolean;
  created_at: string;
  character_count: number | null;
  display_name: string;
  isOnboarded: boolean;
  last_seen_at: string;
}

export interface DownloadQueuePatch {
  current_id: string;
  id?: string;
  watermark?: string;
  no_watermark?: string | null;
}

const USER_RECORD_ID = "user";
const DOWNLOAD_QUEUE_RECORD_ID = "download_queue";

interface SavedAccountRecordBase {
  id: string;
  updated_at: string;
  creators?: string;
  side_characters?: string;
  user_index?: "user";
}

interface SavedCreatorProfileRecord extends SavedAccountRecordBase {
  kind: "creator_profile";
  account_id: string;
  account_type: "creator" | "side_character";
  creators?: string;
  profile: CreatorProfile;
}

interface SavedSideCharacterSelectionRecord extends SavedAccountRecordBase {
  kind: "side_character_selection";
  account_id: string;
  account_type: "side_character";
  profile: null;
  side_characters: string;
}

interface SavedUserRecord extends SavedAccountRecordBase {
  kind: "user";
  account_id: "user";
  account_type: "user";
  profile: null;
  user_index: "user";
  user: SavedUserSession[];
}

interface SavedDownloadQueueRecord extends SavedAccountRecordBase {
  kind: "download_queue";
  queue: DownloadQueueItem[];
}

type SavedAccountRecord =
  | SavedCreatorProfileRecord
  | SavedSideCharacterSelectionRecord
  | SavedUserRecord
  | SavedDownloadQueueRecord;

interface SavedAccountRecordWithUserList extends Partial<SavedAccountRecordBase> {
  kind?: string;
  user?: unknown;
}

interface SavedAccountRecordWithDownloadQueue extends Partial<SavedAccountRecordBase> {
  kind?: string;
  queue?: unknown;
}

interface SavedAccountsStoreLike {
  delete: (id: string) => Promise<unknown>;
  put: (value: SavedDownloadQueueRecord) => Promise<unknown>;
}

/**
 * Session DB persists user settings + lightweight saved profile/session data.
 */
export async function openSessionDb() {
  return openSaveSoraV3Db();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const database = await openSessionDb();
  await database.put(SETTINGS_STORE, normalizeSettings(settings), SETTINGS_KEY);
}

export async function loadSettings(): Promise<AppSettings | null> {
  const database = await openSessionDb();
  const rawSettings: unknown = await database.get(SETTINGS_STORE, SETTINGS_KEY);
  if (!rawSettings || typeof rawSettings !== "object") {
    return null;
  }
  return normalizeSettings(rawSettings as Partial<AppSettings>);
}

export async function loadDownloadQueue(): Promise<DownloadQueueItem[]> {
  const database = await openSessionDb();
  return extractDownloadQueueItems(await database.get(SAVED_ACCOUNTS_STORE, DOWNLOAD_QUEUE_RECORD_ID));
}

export async function replaceDownloadQueue(items: DownloadQueueItem[]): Promise<DownloadQueueItem[]> {
  const database = await openSessionDb();
  const transaction = database.transaction(SAVED_ACCOUNTS_STORE, "readwrite");
  const savedAccountsStore = transaction.objectStore(SAVED_ACCOUNTS_STORE);
  const normalizedQueue = normalizeDownloadQueueItems(items);
  await saveDownloadQueueRecord(savedAccountsStore, normalizedQueue);
  await transaction.done;
  return normalizedQueue;
}

export async function patchDownloadQueue(patches: DownloadQueuePatch[]): Promise<DownloadQueueItem[]> {
  if (!Array.isArray(patches) || patches.length === 0) {
    return loadDownloadQueue();
  }

  const database = await openSessionDb();
  const transaction = database.transaction(SAVED_ACCOUNTS_STORE, "readwrite");
  const savedAccountsStore = transaction.objectStore(SAVED_ACCOUNTS_STORE);
  const currentItems = extractDownloadQueueItems(await savedAccountsStore.get(DOWNLOAD_QUEUE_RECORD_ID));
  if (currentItems.length === 0) {
    await transaction.done;
    return [];
  }

  const normalizedPatches = patches.filter((entry) => isDownloadQueuePatch(entry));
  if (normalizedPatches.length === 0) {
    await transaction.done;
    return currentItems;
  }

  const patchedItems = currentItems.map((entry) => {
    let nextEntry = entry;
    for (const patch of normalizedPatches) {
      if (patch.current_id !== nextEntry.id) {
        continue;
      }
      nextEntry = {
        id: typeof patch.id === "string" && patch.id.trim() ? patch.id.trim() : nextEntry.id,
        watermark: typeof patch.watermark === "string" && patch.watermark.trim()
          ? patch.watermark.trim()
          : nextEntry.watermark,
        no_watermark: patch.no_watermark === undefined
          ? nextEntry.no_watermark
          : normalizeOptionalUrl(patch.no_watermark)
      };
    }
    return nextEntry;
  });

  const normalizedPatchedItems = normalizeDownloadQueueItems(patchedItems);
  await saveDownloadQueueRecord(savedAccountsStore, normalizedPatchedItems);
  await transaction.done;
  return normalizedPatchedItems;
}

export async function clearDownloadQueue(): Promise<void> {
  const database = await openSessionDb();
  await database.delete(SAVED_ACCOUNTS_STORE, DOWNLOAD_QUEUE_RECORD_ID);
}

export async function saveSessionState(state: PersistedSessionState): Promise<void> {
  const database = await openSessionDb();
  const transaction = database.transaction(SAVED_ACCOUNTS_STORE, "readwrite");
  const savedAccountsStore = transaction.objectStore(SAVED_ACCOUNTS_STORE);
  const existingUserSessions = extractSavedUserSessions(await savedAccountsStore.get(USER_RECORD_ID));
  const existingDownloadQueue = extractDownloadQueueItems(await savedAccountsStore.get(DOWNLOAD_QUEUE_RECORD_ID));
  await savedAccountsStore.clear();

  const nowIso = new Date().toISOString();
  const incomingUserSessions = sanitizeSavedUserSessions(state.user ?? []);
  const mergedUserSessions = mergeSavedUserSessions(existingUserSessions, incomingUserSessions, nowIso);
  for (const profile of state.creator_profiles) {
    if (!isCreatorProfile(profile)) {
      continue;
    }
    const accountType: SavedCreatorProfileRecord["account_type"] =
      profile.account_type === "sideCharacter" || profile.is_character_profile ? "side_character" : "creator";
    const recordBase: SavedCreatorProfileRecord = {
      id: `creator_profile:${profile.profile_id}`,
      kind: "creator_profile",
      account_id: profile.profile_id,
      account_type: accountType,
      profile,
      updated_at: nowIso
    };
    const record = accountType === "creator"
      ? { ...recordBase, creators: profile.profile_id }
      : recordBase;
    await savedAccountsStore.put(record);
  }

  const selectedCharacterAccountIds = [...new Set(
    state.selected_character_account_ids
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
  for (const accountId of selectedCharacterAccountIds) {
    const record: SavedSideCharacterSelectionRecord = {
      id: `side_character_selection:${accountId}`,
      kind: "side_character_selection",
      account_id: accountId,
      account_type: "side_character",
      side_characters: accountId,
      profile: null,
      updated_at: nowIso
    };
    await savedAccountsStore.put(record);
  }

  if (mergedUserSessions.length > 0) {
    const userRecord: SavedUserRecord = {
      id: USER_RECORD_ID,
      kind: "user",
      account_id: USER_RECORD_ID,
      account_type: "user",
      user_index: USER_RECORD_ID,
      profile: null,
      user: mergedUserSessions,
      updated_at: nowIso
    };
    await savedAccountsStore.put(userRecord);
  }

  if (existingDownloadQueue.length > 0) {
    await saveDownloadQueueRecord(savedAccountsStore, existingDownloadQueue, nowIso);
  }

  await transaction.done;
}

export async function loadSessionState(): Promise<PersistedSessionState | null> {
  const database = await openSessionDb();
  const rawRows = await database.getAll(SAVED_ACCOUNTS_STORE);
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return null;
  }

  const creatorProfiles: CreatorProfile[] = [];
  const selectedCharacterAccountIds = new Set<string>();
  const userSessions: SavedUserSession[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Partial<SavedAccountRecord>;
    if (record.kind === "creator_profile" && isCreatorProfile(record.profile)) {
      creatorProfiles.push(record.profile);
      continue;
    }
    if (
      record.kind === "side_character_selection" &&
      typeof record.account_id === "string" &&
      record.account_id.trim().length > 0
    ) {
      selectedCharacterAccountIds.add(record.account_id.trim());
      continue;
    }
    if (record.kind === "user") {
      userSessions.push(...extractSavedUserSessions(record));
    }
  }

  if (creatorProfiles.length === 0 && selectedCharacterAccountIds.size === 0 && userSessions.length === 0) {
    return null;
  }

  const persistedState: PersistedSessionState = {
    creator_profiles: creatorProfiles,
    selected_character_account_ids: [...selectedCharacterAccountIds]
  };
  const dedupedUserSessions = dedupeSavedUserSessions(userSessions);
  if (dedupedUserSessions.length > 0) {
    persistedState.user = dedupedUserSessions;
  }
  return persistedState;
}

function isCreatorProfile(value: unknown): value is CreatorProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.profile_id === "string" &&
    typeof record.user_id === "string" &&
    typeof record.username === "string" &&
    typeof record.display_name === "string" &&
    typeof record.permalink === "string" &&
    typeof record.is_character_profile === "boolean" &&
    typeof record.created_at === "string"
  );
}

function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const archiveNameTemplate = typeof input.archive_name_template === "string" && input.archive_name_template.trim()
    ? input.archive_name_template.trim()
    : DEFAULT_SETTINGS.archive_name_template;
  const downloadDirectoryName = typeof input.download_directory_name === "string"
    ? input.download_directory_name.trim()
    : DEFAULT_SETTINGS.download_directory_name;
  const rememberedDateRangePreset = input.remembered_date_range_preset === "24h" ||
    input.remembered_date_range_preset === "7d" ||
    input.remembered_date_range_preset === "1m" ||
    input.remembered_date_range_preset === "3m" ||
    input.remembered_date_range_preset === "all" ||
    input.remembered_date_range_preset === "custom"
    ? input.remembered_date_range_preset
    : DEFAULT_SETTINGS.remembered_date_range_preset;
  const rememberedCustomDateStart = typeof input.remembered_custom_date_start === "string"
    ? input.remembered_custom_date_start.trim()
    : "";
  const rememberedCustomDateEnd = typeof input.remembered_custom_date_end === "string"
    ? input.remembered_custom_date_end.trim()
    : "";

  return {
    archive_name_template: archiveNameTemplate,
    download_directory_name: downloadDirectoryName,
    retry_failed_watermark_removals: input.retry_failed_watermark_removals === true,
    enable_fetch_resume: input.enable_fetch_resume === true,
    remember_fetch_date_choice: input.remember_fetch_date_choice === true,
    remembered_date_range_preset: rememberedDateRangePreset,
    remembered_custom_date_start: rememberedCustomDateStart,
    remembered_custom_date_end: rememberedCustomDateEnd
  };
}

function sanitizeSavedUserSessions(entries: SavedUserSession[]): SavedUserSession[] {
  const sanitizedEntries: SavedUserSession[] = [];
  for (const entry of entries) {
    if (!isSavedUserSession(entry)) {
      continue;
    }
    sanitizedEntries.push({
      ...entry,
      isOnboarded: entry.isOnboarded === true,
      last_seen_at: entry.last_seen_at.trim()
    });
  }
  return dedupeSavedUserSessions(sanitizedEntries);
}

function mergeSavedUserSessions(
  existingEntries: SavedUserSession[],
  incomingEntries: SavedUserSession[],
  nowIso: string
): SavedUserSession[] {
  const mergedByUserId = new Map<string, SavedUserSession>();
  for (const entry of [...existingEntries, ...incomingEntries]) {
    const normalizedUserId = entry.user_id.trim();
    if (!normalizedUserId) {
      continue;
    }
    const previous = mergedByUserId.get(normalizedUserId);
    const mergedEntry: SavedUserSession = {
      ...previous,
      ...entry,
      user_id: normalizedUserId,
      username: entry.username.trim(),
      display_name: entry.display_name.trim(),
      permalink: entry.permalink.trim(),
      created_at: entry.created_at.trim(),
      isOnboarded: previous?.isOnboarded === true || entry.isOnboarded === true,
      last_seen_at: nowIso
    };
    mergedByUserId.set(normalizedUserId, mergedEntry);
  }
  return [...mergedByUserId.values()].sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at));
}

function dedupeSavedUserSessions(entries: SavedUserSession[]): SavedUserSession[] {
  const dedupedByUserId = new Map<string, SavedUserSession>();
  for (const entry of entries) {
    const normalizedUserId = entry.user_id.trim();
    if (!normalizedUserId) {
      continue;
    }
    const existingEntry = dedupedByUserId.get(normalizedUserId);
    if (!existingEntry || existingEntry.last_seen_at.localeCompare(entry.last_seen_at) < 0) {
      dedupedByUserId.set(normalizedUserId, entry);
    }
  }
  return [...dedupedByUserId.values()].sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at));
}

function isSavedUserSession(value: unknown): value is SavedUserSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const characterCount = record.character_count;
  const profilePictureUrl = record.profile_picture_url;
  const planType = record.plan_type;
  const isOnboarded = record.isOnboarded;
  return (
    typeof record.user_id === "string" &&
    typeof record.username === "string" &&
    typeof record.display_name === "string" &&
    typeof record.permalink === "string" &&
    typeof record.created_at === "string" &&
    typeof record.last_seen_at === "string" &&
    typeof record.can_cameo === "boolean" &&
    (isOnboarded === undefined || typeof isOnboarded === "boolean") &&
    (profilePictureUrl === null || typeof profilePictureUrl === "string") &&
    (planType === null || typeof planType === "string") &&
    (characterCount === null || (typeof characterCount === "number" && Number.isFinite(characterCount)))
  );
}

function extractSavedUserSessions(value: unknown): SavedUserSession[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as SavedAccountRecordWithUserList;
  if (record.kind !== "user" || !Array.isArray(record.user)) {
    return [];
  }
  return sanitizeSavedUserSessions(record.user as SavedUserSession[]);
}

async function saveDownloadQueueRecord(
  savedAccountsStore: SavedAccountsStoreLike,
  queueItems: DownloadQueueItem[],
  nowIso = new Date().toISOString()
): Promise<void> {
  const normalizedQueue = normalizeDownloadQueueItems(queueItems);
  if (normalizedQueue.length === 0) {
    await savedAccountsStore.delete(DOWNLOAD_QUEUE_RECORD_ID);
    return;
  }

  const record: SavedDownloadQueueRecord = {
    id: DOWNLOAD_QUEUE_RECORD_ID,
    kind: "download_queue",
    queue: normalizedQueue,
    updated_at: nowIso
  };
  await savedAccountsStore.put(record);
}

function extractDownloadQueueItems(value: unknown): DownloadQueueItem[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as SavedAccountRecordWithDownloadQueue;
  if (record.kind !== "download_queue" || !Array.isArray(record.queue)) {
    return [];
  }
  return normalizeDownloadQueueItems(record.queue as DownloadQueueItem[]);
}

function normalizeDownloadQueueItems(items: DownloadQueueItem[]): DownloadQueueItem[] {
  const normalizedItems: DownloadQueueItem[] = [];
  for (const item of items) {
    if (!isDownloadQueueItem(item)) {
      continue;
    }
    normalizedItems.push({
      id: item.id.trim(),
      watermark: item.watermark.trim(),
      no_watermark: normalizeOptionalUrl(item.no_watermark)
    });
  }
  return normalizedItems;
}

function isDownloadQueueItem(value: unknown): value is DownloadQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.trim().length > 0 &&
    typeof record.watermark === "string" &&
    record.watermark.trim().length > 0 &&
    (record.no_watermark === null ||
      (typeof record.no_watermark === "string" && record.no_watermark.trim().length > 0))
  );
}

function isDownloadQueuePatch(value: unknown): value is DownloadQueuePatch {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.current_id === "string" && record.current_id.trim().length > 0;
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}
