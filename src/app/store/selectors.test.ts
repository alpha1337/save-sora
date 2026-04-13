import { describe, expect, it } from "vitest";
import type { AppStoreState } from "types/store";
import type { VideoRow, VideoSortOption } from "types/domain";
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
    playback_url: "https://videos.openai.com/a.mp4",
    duration_seconds: 12,
    estimated_size_bytes: 1048576,
    width: 1920,
    height: 1080,
    raw_payload_json: "{}",
    is_downloadable: true,
    skip_reason: "",
    fetched_at: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function createState(sortKey: VideoSortOption, rows: VideoRow[]): AppStoreState {
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
      group_by: "none",
      date_range_preset: "all",
      custom_date_start: "",
      custom_date_end: "",
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
      running_workers: 0,
      total_items: 0,
      total_workers: 0,
      worker_progress: []
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

    expect(selectFilteredVideoRows(createState("views_most", rows)).map((row) => row.video_id)).toEqual([
      "s_beta",
      "s_gamma",
      "s_alpha"
    ]);
  });

  it("sorts by title alphabetically", () => {
    const rows = [
      createRow({ row_id: "profile:s_beta", video_id: "s_beta", title: "Beta", creator_name: "Zeta Studio" }),
      createRow({ row_id: "profile:s_alpha", video_id: "s_alpha", title: "Alpha", creator_name: "Alpha Studio" })
    ];

    expect(selectFilteredVideoRows(createState("title_asc", rows)).map((row) => row.video_id)).toEqual([
      "s_alpha",
      "s_beta"
    ]);
  });

  it("sorts by published date oldest first", () => {
    const rows = [
      createRow({ row_id: "profile:s_new", video_id: "s_new", published_at: "2026-04-12T11:00:00.000Z" }),
      createRow({ row_id: "profile:s_old", video_id: "s_old", published_at: "2026-04-01T11:00:00.000Z" })
    ];

    expect(selectFilteredVideoRows(createState("published_oldest", rows)).map((row) => row.video_id)).toEqual([
      "s_old",
      "s_new"
    ]);
  });

  it("sorts by created date newest first", () => {
    const rows = [
      createRow({ row_id: "profile:s_new", video_id: "s_new", created_at: "2026-04-12T10:00:00.000Z" }),
      createRow({ row_id: "profile:s_old", video_id: "s_old", created_at: "2026-04-01T10:00:00.000Z" })
    ];

    expect(selectFilteredVideoRows(createState("created_newest", rows)).map((row) => row.video_id)).toEqual([
      "s_new",
      "s_old"
    ]);
  });

  it("sorts by likes and remixes in both directions", () => {
    const rows = [
      createRow({ row_id: "profile:s_a", video_id: "s_a", like_count: 12, remix_count: 3, title: "A" }),
      createRow({ row_id: "profile:s_b", video_id: "s_b", like_count: 2, remix_count: 8, title: "B" }),
      createRow({ row_id: "profile:s_c", video_id: "s_c", like_count: 20, remix_count: 1, title: "C" })
    ];

    expect(selectFilteredVideoRows(createState("likes_most", rows)).map((row) => row.video_id)).toEqual([
      "s_c",
      "s_a",
      "s_b"
    ]);
    expect(selectFilteredVideoRows(createState("likes_fewest", rows)).map((row) => row.video_id)).toEqual([
      "s_b",
      "s_a",
      "s_c"
    ]);
    expect(selectFilteredVideoRows(createState("remixes_most", rows)).map((row) => row.video_id)).toEqual([
      "s_b",
      "s_a",
      "s_c"
    ]);
    expect(selectFilteredVideoRows(createState("remixes_fewest", rows)).map((row) => row.video_id)).toEqual([
      "s_c",
      "s_a",
      "s_b"
    ]);
  });

  it("returns only visible downloadable ids for select-all behavior", () => {
    const rows = [
      createRow({ row_id: "profile:s_alpha", video_id: "s_alpha", title: "Alpha" }),
      createRow({ row_id: "profile:s_beta", video_id: "s_beta", title: "Beta", is_downloadable: false, skip_reason: "missing_video_id" }),
      createRow({ row_id: "profile:s_gamma", video_id: "s_gamma", title: "Gamma" })
    ];
    const state = createState("title_asc", rows);
    state.session_meta.query = "a";

    expect(selectVisibleDownloadableVideoIds(state)).toEqual(["s_alpha", "s_gamma"]);
  });

  it("filters out rows created by the signed-in session username when others-only is enabled", () => {
    const rows = [
      createRow({ row_id: "profile:s_self", video_id: "s_self", creator_username: "alpha1337", title: "Mine" }),
      createRow({ row_id: "profile:s_other", video_id: "s_other", creator_username: "barista.breezy", title: "Other" })
    ];
    const state = createState("title_asc", rows);
    state.session_meta.viewer_username = "alpha1337";
    state.session_meta.exclude_session_creator_only = true;

    expect(selectFilteredVideoRows(state).map((row) => row.video_id)).toEqual(["s_other"]);
  });
});
