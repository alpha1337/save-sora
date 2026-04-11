import { describe, expect, it } from "vitest";
import type { AppStoreState } from "types/store";
import type { VideoRow, VideoSortKey } from "types/domain";
import { selectFilteredVideoRows, selectVisibleDownloadableVideoIds } from "./selectors";

function createRow(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    row_id: "profile:s_alpha",
    video_id: "s_alpha",
    source_type: "profile",
    source_bucket: "published",
    title: "Alpha",
    prompt: "Alpha prompt",
    discovery_phrase: "Alpha discovery",
    description: "Alpha description",
    caption: "Alpha caption",
    creator_name: "Creator Alpha",
    creator_username: "creator-alpha",
    character_name: "Astra",
    character_username: "astra",
    character_names: ["Astra"],
    category_tags: ["published"],
    created_at: "2026-04-10T10:00:00.000Z",
    published_at: "2026-04-10T11:00:00.000Z",
    like_count: 10,
    view_count: 50,
    share_count: 2,
    repost_count: 1,
    remix_count: 0,
    detail_url: "https://sora.chatgpt.com/p/s_alpha",
    thumbnail_url: "https://videos.openai.com/a.jpg",
    duration_seconds: 12,
    width: 1920,
    height: 1080,
    raw_payload_json: "{}",
    is_downloadable: true,
    skip_reason: "",
    fetched_at: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function createState(sortKey: VideoSortKey, rows: VideoRow[]): AppStoreState {
  return {
    phase: "ready",
    error_message: "",
    settings: {
      archive_name_template: "save-sora-library",
      include_raw_payload_in_csv: true
    },
    session_meta: {
      active_sources: {
        profile: true,
        drafts: false,
        likes: false,
        characters: false,
        characterAccounts: false,
        creators: false
      },
      query: "",
      sort_key: sortKey,
      selected_character_account_ids: [],
      last_fetch_at: null
    },
    creator_profiles: [],
    character_accounts: [],
    video_rows: rows,
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
      total_items: 0
    }
  } as AppStoreState;
}

describe("selectors", () => {
  it("sorts by views descending", () => {
    const rows = [
      createRow({ row_id: "profile:s_alpha", video_id: "s_alpha", title: "Alpha", view_count: 50 }),
      createRow({ row_id: "profile:s_beta", video_id: "s_beta", title: "Beta", view_count: 150 }),
      createRow({ row_id: "profile:s_gamma", video_id: "s_gamma", title: "Gamma", view_count: 75 })
    ];

    expect(selectFilteredVideoRows(createState("view_count", rows)).map((row) => row.video_id)).toEqual([
      "s_beta",
      "s_gamma",
      "s_alpha"
    ]);
  });

  it("sorts by creator name alphabetically", () => {
    const rows = [
      createRow({ row_id: "profile:s_beta", video_id: "s_beta", title: "Beta", creator_name: "Zeta Studio" }),
      createRow({ row_id: "profile:s_alpha", video_id: "s_alpha", title: "Alpha", creator_name: "Alpha Studio" })
    ];

    expect(selectFilteredVideoRows(createState("creator_name", rows)).map((row) => row.video_id)).toEqual([
      "s_alpha",
      "s_beta"
    ]);
  });

  it("returns only visible downloadable ids for select-all behavior", () => {
    const rows = [
      createRow({ row_id: "profile:s_alpha", video_id: "s_alpha", title: "Alpha" }),
      createRow({ row_id: "profile:s_beta", video_id: "s_beta", title: "Beta", is_downloadable: false, skip_reason: "missing_video_id" }),
      createRow({ row_id: "profile:s_gamma", video_id: "s_gamma", title: "Gamma" })
    ];
    const state = createState("title", rows);
    state.session_meta.query = "a";

    expect(selectVisibleDownloadableVideoIds(state)).toEqual(["s_alpha", "s_gamma"]);
  });
});
