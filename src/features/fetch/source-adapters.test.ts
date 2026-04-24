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
      preflight_completed_items: 0,
      preflight_stage: "idle",
      preflight_stage_label: "",
      preflight_total_items: 0,
      rejection_entries: [],
      running_workers: 0,
      swimlanes: [],
      total_items: 0,
      total_workers: 0,
      worker_progress: [],
      zip_completed: false
    }
  } as AppStoreState;
}

describe("buildFetchJobs", () => {
  it("builds a single cameo job for the viewer cameos source", () => {
    const state = createState([]);
    state.session_meta.active_sources.creators = false;
    state.session_meta.active_sources.characters = true;
    state.session_meta.viewer_user_id = "user-abc123";
    state.character_accounts = [
      {
        account_id: "ch_crystal",
        username: "crystal.party",
        display_name: "Crystal Sparkle",
        profile_picture_url: null,
        appearance_count: 524,
        draft_count: 11
      }
    ];

    const jobs = buildFetchJobs(state);

    expect(jobs.map((job) => job.source)).toEqual(["characters"]);
    expect(jobs[0]?.id).toBe("characters-cameos:user-abc123");
    expect(jobs.map((job) => job.expected_total_count)).toEqual([null]);
  });

  it("does not include character draft jobs when cameos are selected", () => {
    const state = createState([]);
    state.session_meta.active_sources.creators = false;
    state.session_meta.active_sources.characters = true;
    state.character_accounts = [];

    const jobs = buildFetchJobs(state);

    expect(jobs.map((job) => job.source)).toEqual(["characters"]);
  });

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

  it("uses local calendar boundaries for custom date ranges", () => {
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
    state.session_meta.date_range_preset = "custom";
    state.session_meta.custom_date_start = "2026-04-20";
    state.session_meta.custom_date_end = "2026-04-22";

    const jobs = buildFetchJobs(state);
    const expectedSinceMs = new Date(2026, 3, 20, 0, 0, 0, 0).getTime();
    const expectedUntilMs = new Date(2026, 3, 22, 23, 59, 59, 999).getTime();

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.fetch_since_ms === expectedSinceMs)).toBe(true);
    expect(jobs.every((job) => job.fetch_until_ms === expectedUntilMs)).toBe(true);
  });

  it("maps character-style creator profiles to side-character appearances fetches", () => {
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

    expect(jobs.map((job) => job.source)).toEqual(["sideCharacter"]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([143852]);
    expect(jobs[0]?.character_id).toBe("ch_crystal");
  });

  it("prefers explicit character ids for character-style creator jobs when available", () => {
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

    expect(jobs.map((job) => job.source)).toEqual(["sideCharacter"]);
    expect(jobs[0]?.character_id).toBe("ch_crystal");
  });

  it("keeps side-character jobs when no explicit ch_* id is available", () => {
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

    expect(jobs.map((job) => job.source)).toEqual(["sideCharacter"]);
    expect(jobs[0]?.id).toBe("side-character-appearances:profile-crystal");
    expect(jobs[0]?.character_id).toBeUndefined();
    expect(jobs[0]?.creator_username).toBe("creator.sample");
    expect(jobs[0]?.route_url).toBe("https://sora.chatgpt.com/profile/creator.sample");
  });

  it("scopes viewer-dependent top-level jobs by viewer identity", () => {
    const state = createState([]);
    state.session_meta.active_sources = {
      profile: true,
      drafts: true,
      likes: true,
      characters: true,
      characterAccounts: false,
      creators: false
    };
    state.session_meta.viewer_username = "Viewer.Sample";

    const jobs = buildFetchJobs(state);
    expect(jobs.map((job) => job.id)).toEqual([
      "profile:viewer-sample",
      "drafts:viewer-sample",
      "likes:viewer-sample",
      "characters-cameos:viewer-sample"
    ]);
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

    expect(jobs.map((job) => job.source)).toEqual(["creatorPublished"]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([1083]);
  });

  it("honors explicit side-character account_type even when published counts are populated", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "profile-crystal",
          user_id: "user_owner_like",
          owner_user_id: "user_not_viewer_1",
          account_type: "sideCharacter",
          username: "crystal.party",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/crystal.party",
          profile_picture_url: null,
          is_character_profile: false,
          published_count: 1086,
          appearance_count: 143852,
          draft_count: 0,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    expect(jobs.map((job) => job.source)).toEqual(["sideCharacter"]);
    expect(jobs[0]?.label).toBe("Crystal Sparkle appearances");
  });

  it("uses owner_user_id for creator jobs when present", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "creator-hybrid",
          user_id: "user_creator_123",
          owner_user_id: "user-owner-123",
          character_user_id: "",
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
    expect(publishedJob?.creator_user_id).toBe("user-owner-123");
  });

  it("does not use ch_* ids as creator_user_id for creator-published jobs", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "creator-hybrid",
          user_id: "ch_crystal",
          owner_user_id: "ch_owner",
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
    expect(publishedJob?.creator_user_id).toBeUndefined();
  });

  it("keeps side-character and character-account jobs separate when both are selected", () => {
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

    expect(jobs.map((job) => job.source)).toEqual(["characterAccountAppearances", "characterAccountDrafts", "sideCharacter"]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([143800, 4, 143852]);
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

    expect(jobs.map((job) => job.source)).toEqual(["characterAccountAppearances", "characterAccountDrafts"]);
    expect(jobs[0]?.label).toBe("Crystal Sparkle appearances");
    expect(jobs[0]?.character_display_name).toBe("Crystal Sparkle");
    expect(jobs[1]?.label).toBe("Crystal Sparkle drafts");
    expect(jobs).toHaveLength(2);
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

  it("falls back to username when display name is empty for character appearance jobs", () => {
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
    const jobs = buildFetchJobs(state);
    const characterJob = jobs.find((job) => job.source === "sideCharacter");
    expect(characterJob?.label).toBe("creator.sample appearances");
  });

  it("falls back to profile_id when creator display name and username are empty", () => {
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
    const characterJob = jobs.find((job) => job.source === "sideCharacter");
    expect(characterJob?.label).toBe("ch_abc123 appearances");
  });

  it("does not treat viewer-owned character profiles as side-character creator jobs", () => {
    const state = createState([
      {
        profile_id: "ch_crystal",
        user_id: "ch_crystal",
        owner_user_id: "user_viewer_123",
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
    state.session_meta.viewer_user_id = "user_viewer_123";

    const jobs = buildFetchJobs(state);

    expect(jobs).toEqual([]);
  });
});
