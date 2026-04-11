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
      sort_key: "published_at",
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
  it("routes character-style creator profiles through the character-account fetch jobs", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "ch_crystal",
          user_id: "ch_crystal",
          username: "crystal.party",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/crystal.party",
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

  it("routes character profiles by flag even when the id is not prefixed with ch_", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "profile-crystal",
          user_id: "profile-crystal",
          username: "crystal.party",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/crystal.party",
          profile_picture_url: null,
          is_character_profile: true,
          published_count: null,
          appearance_count: 143852,
          draft_count: 12,
          created_at: "2026-04-11T00:00:00.000Z"
        }
      ])
    );

    expect(jobs.map((job) => job.source)).toEqual([
      "characterAccountAppearances",
      "characterAccountDrafts"
    ]);
    expect(jobs.map((job) => job.expected_total_count)).toEqual([143852, 12]);
  });

  it("keeps normal creator profiles on the creator fetch path", () => {
    const jobs = buildFetchJobs(
      createState([
        {
          profile_id: "user-crystal",
          user_id: "user-crystal",
          username: "crystal.party",
          display_name: "Crystal Sparkle",
          permalink: "https://sora.chatgpt.com/profile/crystal.party",
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

  it("deduplicates character jobs selected through multiple source groups", () => {
    const state = createState([
      {
        profile_id: "ch_crystal",
        user_id: "ch_crystal",
        username: "crystal.party",
        display_name: "Crystal Sparkle",
        permalink: "https://sora.chatgpt.com/profile/crystal.party",
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
        username: "crystal.party",
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
});
