import { beforeEach, describe, expect, it } from "vitest";
import {
  loadSessionState,
  loadSettings,
  openSessionDb,
  saveSessionState,
  saveSettings
} from "./session-db";

describe("session-db", () => {
  beforeEach(async () => {
    const database = await openSessionDb();
    await database.clear("settings");
    await database.clear("session_state");
  });

  it("persists settings", async () => {
    await saveSettings({
      archive_name_template: "archive-test",
      enable_fetch_resume: true,
      remember_fetch_date_choice: true,
      remembered_date_range_preset: "all",
      remembered_custom_date_start: "",
      remembered_custom_date_end: ""
    });

    await expect(loadSettings()).resolves.toEqual({
      archive_name_template: "archive-test",
      enable_fetch_resume: true,
      remember_fetch_date_choice: true,
      remembered_date_range_preset: "all",
      remembered_custom_date_start: "",
      remembered_custom_date_end: ""
    });
  });

  it("persists saved profiles and selected character ids", async () => {
    await saveSessionState({
      creator_profiles: [
        {
          profile_id: "ch_123",
          user_id: "ch_123",
          account_type: "sideCharacter",
          username: "next.thur.thursday",
          display_name: "Thursday",
          permalink: "https://sora.chatgpt.com/profile/next.thur.thursday",
          profile_picture_url: null,
          is_character_profile: true,
          published_count: 0,
          appearance_count: 524,
          draft_count: null,
          created_at: "2026-04-01T00:00:00.000Z"
        }
      ],
      selected_character_account_ids: ["ch_123", "ch_123"]
    });

    await expect(loadSessionState()).resolves.toEqual({
      creator_profiles: [
        {
          profile_id: "ch_123",
          user_id: "ch_123",
          account_type: "sideCharacter",
          username: "next.thur.thursday",
          display_name: "Thursday",
          permalink: "https://sora.chatgpt.com/profile/next.thur.thursday",
          profile_picture_url: null,
          is_character_profile: true,
          published_count: 0,
          appearance_count: 524,
          draft_count: null,
          created_at: "2026-04-01T00:00:00.000Z"
        }
      ],
      selected_character_account_ids: ["ch_123"]
    });
  });

  it("returns null when no session state is saved", async () => {
    await expect(loadSessionState()).resolves.toBeNull();
  });
});
