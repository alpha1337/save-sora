import { openDB } from "idb";
import type { AppSettings, CreatorProfile } from "types/domain";

const SESSION_DB_NAME = "save-sora-v2-session";
const SESSION_DB_VERSION = 3;
const SETTINGS_STORE = "settings";
const SESSION_STATE_STORE = "session_state";
const SETTINGS_KEY = "settings";
const SESSION_STATE_KEY = "session_state";
const DEFAULT_SETTINGS: AppSettings = {
  archive_name_template: "save-sora-library",
  enable_fetch_resume: false,
  remember_fetch_date_choice: false,
  remembered_date_range_preset: "all",
  remembered_custom_date_start: "",
  remembered_custom_date_end: ""
};

export interface PersistedSessionState {
  creator_profiles: CreatorProfile[];
  selected_character_account_ids: string[];
}

/**
 * Session DB persists user settings + lightweight saved profile/session data.
 */
export async function openSessionDb() {
  return openDB(SESSION_DB_NAME, SESSION_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
      if (!database.objectStoreNames.contains(SESSION_STATE_STORE)) {
        database.createObjectStore(SESSION_STATE_STORE);
      }
    }
  });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const database = await openSessionDb();
  await database.put(SETTINGS_STORE, normalizeSettings(settings), SETTINGS_KEY);
}

export async function loadSettings(): Promise<AppSettings | null> {
  const database = await openSessionDb();
  const rawSettings = await database.get(SETTINGS_STORE, SETTINGS_KEY);
  if (!rawSettings || typeof rawSettings !== "object") {
    return null;
  }
  return normalizeSettings(rawSettings as Partial<AppSettings>);
}

export async function saveSessionState(state: PersistedSessionState): Promise<void> {
  const database = await openSessionDb();
  await database.put(SESSION_STATE_STORE, {
    creator_profiles: state.creator_profiles,
    selected_character_account_ids: state.selected_character_account_ids
  }, SESSION_STATE_KEY);
}

export async function loadSessionState(): Promise<PersistedSessionState | null> {
  const database = await openSessionDb();
  const rawState = await database.get(SESSION_STATE_STORE, SESSION_STATE_KEY);
  if (!rawState || typeof rawState !== "object") {
    return null;
  }

  const record = rawState as Record<string, unknown>;
  const creatorProfiles = Array.isArray(record.creator_profiles)
    ? record.creator_profiles.filter((entry): entry is CreatorProfile => isCreatorProfile(entry))
    : [];
  const selectedCharacterAccountIds = Array.isArray(record.selected_character_account_ids)
    ? record.selected_character_account_ids.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  return {
    creator_profiles: creatorProfiles,
    selected_character_account_ids: [...new Set(selectedCharacterAccountIds)]
  };
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
    enable_fetch_resume: input.enable_fetch_resume === true,
    remember_fetch_date_choice: input.remember_fetch_date_choice === true,
    remembered_date_range_preset: rememberedDateRangePreset,
    remembered_custom_date_start: rememberedCustomDateStart,
    remembered_custom_date_end: rememberedCustomDateEnd
  };
}
