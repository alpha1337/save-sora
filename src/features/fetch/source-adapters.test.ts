import { describe, expect, it } from "vitest";
import type { AppStoreState } from "types/store";
import type { CreatorProfile } from "types/domain";
import { buildFetchJobs } from "./source-adapters";

function createState(creatorProfiles: CreatorProfile[]): AppStoreState {
  return {
    phase: "idle",
    error_message: "",
    settings: {
      archive_name_template: "save-sora-library",
      include_raw_payload_in_csv: true
    },
    session_meta: {
      active_sources: {
        profile: false,
        drafts: false,
        likes: false,
        characters: false,
        characterAccounts: false,
        creators: true
      },
      query: "",
      sort_key: "published_newest",
      group_by: "none",
      date_range_preset: "all",
      custom_date_start: "",
      custom_date_end: "",
      selected_character_account_ids: [],
      last_fetch_at: null
    },
    creator_profiles: creatorProfiles,
    character_accounts: [],
    video_rows: [],
    selected_video_ids: [],
    download_history_ids: [],
    fetch_progress: {
      active_label: "",
      completed_jobs: 0,
      processed_batches: 0,
      processed_rows: 0,
      running_jobs: 0,
      total_jobs: 0,
      job_progress: []
    },
    download_progress: {
      active_label: "",
      completed_items: 0,
      running_workers: 0,
      total_items: 0,
      total_workers: 0,
      worker_progress: []
    }
  } as AppStoreState;
}

describe("buildFetchJobs", () => {
  it("attaches the selected time window to fetch jobs", () => {
    const state = createState([
      {
        profile_id: "user-crystal",
        user_id: "user-crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        permalink: "https://sora.chatgpt.com/profile/creator.sample",
        profile_picture_url: null,
        is_character_profile: false,
        published_count: 1083,
        appearance_count: 3634,
        draft_count: null,
        created_at: "2026-04-11T00:00:00.000Z"
      }
    ]);
    state.session_meta.date_range_preset = "24h";

    const jobs = buildFetchJobs(state);

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => typeof job.fetch_since_ms === "number")).toBe(true);
    expect(jobs.every((job) => typeof job.fetch_until_ms === "number")).toBe(true);
  });

  it("routes character-style creator profiles through the character-account fetch jobs", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "ch_crystal",
          user_id: "ch_crystal",
          username: "creator.sample",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/creator.sample",
          profile_picture_url: null,
          is_character_profile: true,
          published_count: null,
          appearance_count: 143852,
          draft_count: null,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    expect(jobs.map((job) => job.source)).toEqual([
      "characterAccountAppearances",
      "characterAccountDrafts"
    ]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([143852, null]);
  });

  it("prefers ch_* character ids when creator payload also contains an owner user id", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "ch_crystal",
          user_id: "user_owner_123",
          username: "creator.sample",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/creator.sample",
          profile_picture_url: null,
          is_character_profile: true,
          published_count: null,
          appearance_count: 143852,
          draft_count: 4,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    const appearancesJob = jobs.find((job) => job.source === "characterAccountAppearances");
    const draftsJob = jobs.find((job) => job.source === "characterAccountDrafts");

    expect(appearancesJob?.character_id).toBe("ch_crystal");
    expect(draftsJob?.character_id).toBe("ch_crystal");
  });

  it("skips character-style creator profiles when no ch_* id is available", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "profile-crystal",
          user_id: "profile-crystal",
          username: "creator.sample",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/creator.sample",
          profile_picture_url: null,
          is_character_profile: true,
          published_count: null,
          appearance_count: 143852,
          draft_count: 12,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    expect(jobs).toEqual([]);
  });

  it("keeps normal creator profiles on the creator fetch path", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "user-crystal",
          user_id: "user-crystal",
          username: "creator.sample",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/creator.sample",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 1083,
          appearance_count: 3634,
          draft_count: null,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    expect(jobs.map((job) => job.source)).toEqual([
      "creatorPublished",
      "creatorCameos"
    ]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([1083, 3634]);
  });

  it("uses owner_user_id for creator jobs when present", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "creator-hybrid",
          user_id: "ch_crystal",
          owner_user_id: "user_owner_123",
          character_user_id: "ch_crystal",
          username: "creator.sample",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/creator.sample",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 1083,
          appearance_count: 3634,
          draft_count: null,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    const publishedJob = jobs.find((job) => job.source === "creatorPublished");
    const cameosJob = jobs.find((job) => job.source === "creatorCameos");
    expect(publishedJob?.creator_user_id).toBe("user_owner_123");
    expect(cameosJob?.creator_user_id).toBe("user_owner_123");
  });

  it("deduplicates character jobs selected through multiple source groups", () => {
    const state = createState([
      {
        profile_id: "ch_crystal",
        user_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        permalink: "https://sora.chatgpt.com/profile/creator.sample",
        profile_picture_url: null,
        is_character_profile: true,
        published_count: null,
        appearance_count: 143852,
        draft_count: 4,
        created_at: "2026-04-11T00:00:00.000Z"
      }
    ]);
    state.session_meta.active_sources.characterAccounts = true;
    state.character_accounts = [
      {
        account_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        profile_picture_url: null,
        appearance_count: 143800,
        draft_count: 4
      }
    ];
    state.session_meta.selected_character_account_ids = ["ch_crystal"];

    const jobs = buildFetchJobs(state);

    expect(jobs.map((job) => job.source)).toEqual([
      "characterAccountAppearances",
      "characterAccountDrafts"
    ]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([143852, 4]);
  });

  it("uses character display name from creator profiles when character account cache is empty", () => {
    const state = createState([
      {
        profile_id: "ch_crystal",
        user_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        permalink: "https://sora.chatgpt.com/profile/creator.sample",
        profile_picture_url: null,
        is_character_profile: true,
        published_count: null,
        appearance_count: 143852,
        draft_count: 4,
        created_at: "2026-04-11T00:00:00.000Z"
      }
    ]);
    state.session_meta.active_sources.creators = false;
    state.session_meta.active_sources.characterAccounts = true;
    state.session_meta.selected_character_account_ids = ["ch_crystal"];
    state.character_accounts = [];

    const jobs = buildFetchJobs(state);

    expect(jobs[0]?.label).toBe("Crystal Sparkle appearances");
    expect(jobs[1]?.label).toBe("Crystal Sparkle drafts");
    expect(jobs[0]?.character_display_name).toBe("Crystal Sparkle");
  });

  it("ignores selected character accounts that are not ch_* ids", () => {
    const state = createState([]);
    state.session_meta.active_sources.creators = false;
    state.session_meta.active_sources.characterAccounts = true;
    state.session_meta.selected_character_account_ids = ["user_owner_123"];
    state.character_accounts = [
      {
        account_id: "user_owner_123",
        username: "creator.sample",
        display_name: "Owner Account",
        profile_picture_url: null,
        appearance_count: 99,
        draft_count: 5
      }
    ];

    const jobs = buildFetchJobs(state);

    expect(jobs).toEqual([]);
  });

  it("falls back to profile_id and cached account display name for creator-character jobs", () => {
    const state = createState([
      {
        profile_id: "ch_crystal",
        user_id: "",
        username: "creator.sample",
        display_name: "",
        permalink: "https://sora.chatgpt.com/profile/creator.sample",
        profile_picture_url: null,
        is_character_profile: true,
        published_count: null,
        appearance_count: 143852,
        draft_count: 4,
        created_at: "2026-04-11T00:00:00.000Z"
      }
    ]);
    state.character_accounts = [
      {
        account_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        profile_picture_url: null,
        appearance_count: 143852,
        draft_count: 4
      }
    ];

    const jobs = buildFetchJobs(state);
    const appearancesJob = jobs.find((job) => job.source === "characterAccountAppearances");
    const draftsJob = jobs.find((job) => job.source === "characterAccountDrafts");

    expect(appearancesJob?.character_id).toBe("ch_crystal");
    expect(draftsJob?.character_id).toBe("ch_crystal");
    expect(appearancesJob?.label).toBe("Crystal Sparkle appearances");
    expect(draftsJob?.label).toBe("Crystal Sparkle drafts");
    expect(appearancesJob?.character_display_name).toBe("Crystal Sparkle");
  });

  it("uses permalink slug when character profile display and username are empty", () => {
    const state = createState([
      {
        profile_id: "ch_abc123",
        user_id: "",
        username: "",
        display_name: "",
        permalink: "https://sora.chatgpt.com/profile/creator.sample",
        profile_picture_url: null,
        is_character_profile: true,
        published_count: null,
        appearance_count: 10,
        draft_count: 2,
        created_at: "2026-04-11T00:00:00.000Z"
      }
    ]);

    const jobs = buildFetchJobs(state);
    const appearancesJob = jobs.find((job) => job.source === "characterAccountAppearances");
    const draftsJob = jobs.find((job) => job.source === "characterAccountDrafts");

    expect(appearancesJob?.label).toBe("creator.sample appearances");
    expect(draftsJob?.label).toBe("creator.sample drafts");
    expect(appearancesJob?.character_display_name).toBe("creator.sample");
  });
});
