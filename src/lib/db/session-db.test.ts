import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDownloadQueue,
  loadDownloadQueue,
  loadSessionState,
  loadSettings,
  openSessionDb,
  patchDownloadQueue,
  replaceDownloadQueue,
  saveSessionState,
  saveSettings
} from "./session-db";
import {
  SAVED_ACCOUNTS_CREATORS_INDEX,
  SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX,
  SAVED_ACCOUNTS_USER_INDEX
} from "./save-sora-v3-db";

describe("session-db", () => {
  beforeEach(async () => {
    const database = await openSessionDb();
    await database.clear("settings");
    await database.clear("saved_accounts");
  });

  it("persists settings", async () => {
    await saveSettings({
      archive_name_template: "archive-test",
      download_directory_name: "Sora exports",
      retry_failed_watermark_removals: true,
      enable_fetch_resume: true,
      remember_fetch_date_choice: true,
      remembered_date_range_preset: "all",
      remembered_custom_date_start: "",
      remembered_custom_date_end: ""
    });

    await expect(loadSettings()).resolves.toEqual({
      archive_name_template: "archive-test",
      download_directory_name: "Sora exports",
      retry_failed_watermark_removals: true,
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
        },
        {
          profile_id: "user-creator-1",
          user_id: "user-creator-1",
          account_type: "creator",
          username: "creator.one",
          display_name: "Creator One",
          permalink: "https://sora.chatgpt.com/profile/creator.one",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 2,
          appearance_count: 0,
          draft_count: 1,
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
        },
        {
          profile_id: "user-creator-1",
          user_id: "user-creator-1",
          account_type: "creator",
          username: "creator.one",
          display_name: "Creator One",
          permalink: "https://sora.chatgpt.com/profile/creator.one",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 2,
          appearance_count: 0,
          draft_count: 1,
          created_at: "2026-04-01T00:00:00.000Z"
        }
      ],
      selected_character_account_ids: ["ch_123"]
    });
  });

  it("persists user session metadata in saved_accounts.user", async () => {
    await saveSessionState({
      creator_profiles: [],
      selected_character_account_ids: [],
      user: [
        {
          user_id: "user-1",
          username: "whatreallyhappened",
          profile_picture_url: "https://example.com/avatar.png",
          plan_type: "plus",
          permalink: "https://sora.chatgpt.com/profile/whatreallyhappened",
          can_cameo: true,
          created_at: "1760411457.623549",
          character_count: 6,
          display_name: "What Really Happened",
          isOnboarded: true,
          last_seen_at: "2026-04-23T00:00:00.000Z"
        }
      ]
    });

    const loaded = await loadSessionState();
    expect(loaded?.user).toHaveLength(1);
    expect(loaded?.user?.[0]).toMatchObject({
      user_id: "user-1",
      username: "whatreallyhappened",
      plan_type: "plus",
      isOnboarded: true,
      character_count: 6
    });
  });

  it("indexes creators, side characters, and user records separately", async () => {
    await saveSessionState({
      creator_profiles: [
        {
          profile_id: "user-creator-1",
          user_id: "user-creator-1",
          account_type: "creator",
          username: "creator.one",
          display_name: "Creator One",
          permalink: "https://sora.chatgpt.com/profile/creator.one",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 2,
          appearance_count: 0,
          draft_count: 1,
          created_at: "2026-04-01T00:00:00.000Z"
        },
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
      selected_character_account_ids: ["ch_123"],
      user: [
        {
          user_id: "user-1",
          username: "whatreallyhappened",
          profile_picture_url: "https://example.com/avatar.png",
          plan_type: null,
          permalink: "https://sora.chatgpt.com/profile/whatreallyhappened",
          can_cameo: true,
          created_at: "1760411457.623549",
          character_count: 6,
          display_name: "What Really Happened",
          isOnboarded: false,
          last_seen_at: "2026-04-23T00:00:00.000Z"
        }
      ]
    });

    const database = await openSessionDb();
    const transaction = database.transaction("saved_accounts", "readonly");
    const store = transaction.objectStore("saved_accounts");
    const creatorRows = await store.index(SAVED_ACCOUNTS_CREATORS_INDEX).getAll();
    const sideCharacterRows = await store.index(SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX).getAll();
    const userRows = await store.index(SAVED_ACCOUNTS_USER_INDEX).getAll();

    expect(creatorRows).toHaveLength(1);
    expect(sideCharacterRows).toHaveLength(1);
    expect(userRows).toHaveLength(1);
    expect((creatorRows[0] as { kind?: string }).kind).toBe("creator_profile");
    expect((sideCharacterRows[0] as { kind?: string }).kind).toBe("side_character_selection");
    expect((userRows[0] as { kind?: string }).kind).toBe("user");
    await transaction.done;
  });

  it("replaces, patches, and clears download_queue record", async () => {
    await expect(loadDownloadQueue()).resolves.toEqual([]);

    const replacedQueue = await replaceDownloadQueue([
      {
        id: "gen_123",
        watermark: "https://videos.openai.com/watermark-a.mp4",
        no_watermark: null
      },
      {
        id: "s_456",
        watermark: "https://videos.openai.com/watermark-b.mp4",
        no_watermark: "https://videos.openai.com/no-watermark-b.mp4"
      }
    ]);
    expect(replacedQueue).toHaveLength(2);

    const patchedQueue = await patchDownloadQueue([
      {
        current_id: "gen_123",
        id: "s_123",
        no_watermark: "https://videos.openai.com/no-watermark-a.mp4"
      }
    ]);
    expect(patchedQueue).toEqual([
      {
        id: "s_123",
        watermark: "https://videos.openai.com/watermark-a.mp4",
        no_watermark: "https://videos.openai.com/no-watermark-a.mp4"
      },
      {
        id: "s_456",
        watermark: "https://videos.openai.com/watermark-b.mp4",
        no_watermark: "https://videos.openai.com/no-watermark-b.mp4"
      }
    ]);

    await clearDownloadQueue();
    await expect(loadDownloadQueue()).resolves.toEqual([]);
  });

  it("persists download_queue with the exact saved_accounts schema", async () => {
    await replaceDownloadQueue([
      {
        id: "s_exact",
        watermark: "https://videos.openai.com/watermark-exact.mp4",
        no_watermark: null
      }
    ]);

    const database = await openSessionDb();
    const record = await database.get("saved_accounts", "download_queue") as Record<string, unknown>;

    expect(Object.keys(record).sort()).toEqual(["id", "kind", "queue", "updated_at"]);
    expect(record.id).toBe("download_queue");
    expect(record.kind).toBe("download_queue");
    expect(record.queue).toEqual([
      {
        id: "s_exact",
        watermark: "https://videos.openai.com/watermark-exact.mp4",
        no_watermark: null
      }
    ]);
    expect(typeof record.updated_at).toBe("string");
  });

  it("applies download_queue patches in batches while preserving order", async () => {
    await replaceDownloadQueue(Array.from({ length: 25 }, (_value, index) => ({
      id: `s_${index}`,
      watermark: `https://videos.openai.com/watermark-${index}.mp4`,
      no_watermark: null
    })));

    const firstBatchPatch = Array.from({ length: 24 }, (_value, index) => ({
      current_id: `s_${index}`,
      no_watermark: `https://videos.openai.com/no-watermark-${index}.mp4`
    }));
    await patchDownloadQueue(firstBatchPatch);
    const patchedQueue = await patchDownloadQueue([
      {
        current_id: "s_24",
        id: "s_24_converted",
        no_watermark: "https://videos.openai.com/no-watermark-24.mp4"
      }
    ]);

    expect(patchedQueue).toHaveLength(25);
    expect(patchedQueue[0]).toEqual({
      id: "s_0",
      watermark: "https://videos.openai.com/watermark-0.mp4",
      no_watermark: "https://videos.openai.com/no-watermark-0.mp4"
    });
    expect(patchedQueue[24]).toEqual({
      id: "s_24_converted",
      watermark: "https://videos.openai.com/watermark-24.mp4",
      no_watermark: "https://videos.openai.com/no-watermark-24.mp4"
    });
  });

  it("preserves download_queue while replacing saved session state", async () => {
    await replaceDownloadQueue([
      {
        id: "s_999",
        watermark: "https://videos.openai.com/watermark-z.mp4",
        no_watermark: null
      }
    ]);

    await saveSessionState({
      creator_profiles: [
        {
          profile_id: "user-creator-1",
          user_id: "user-creator-1",
          account_type: "creator",
          username: "creator.one",
          display_name: "Creator One",
          permalink: "https://sora.chatgpt.com/profile/creator.one",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 2,
          appearance_count: 0,
          draft_count: 1,
          created_at: "2026-04-01T00:00:00.000Z"
        }
      ],
      selected_character_account_ids: []
    });

    await expect(loadDownloadQueue()).resolves.toEqual([
      {
        id: "s_999",
        watermark: "https://videos.openai.com/watermark-z.mp4",
        no_watermark: null
      }
    ]);
  });

  it("returns null when no session state is saved", async () => {
    await expect(loadSessionState()).resolves.toBeNull();
  });
});
