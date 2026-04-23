import { describe, expect, it } from "vitest";
import type { VideoRow } from "types/domain";
import { buildArchiveWorkPlan } from "./build-archive-work-plan";

function createRow(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    row_id: "profile:s_alpha123",
    video_id: "s_alpha123",
    source_type: "profile",
    source_bucket: "published",
    title: "Nebula Run",
    prompt: "A cinematic space dogfight.",
    discovery_phrase: "space dogfight",
    description: "A cinematic space dogfight.",
    caption: "Nebula Run",
    creator_name: "Alex Mercer",
    creator_username: "alex",
    character_name: "Nova",
    character_username: "nova",
    character_names: ["Nova"],
    category_tags: ["published"],
    created_at: "2026-04-11T00:00:00.000Z",
    published_at: "2026-04-11T00:00:00.000Z",
    like_count: 10,
    view_count: 20,
    share_count: 2,
    repost_count: 1,
    remix_count: 0,
    detail_url: "https://sora.chatgpt.com/p/s_alpha123",
    thumbnail_url: "https://videos.openai.com/thumb.jpg",
    playback_url: "https://videos.openai.com/raw.mp4",
    download_url: "https://videos.openai.com/raw.mp4",
    duration_seconds: 12,
    estimated_size_bytes: 1048576,
    width: 1920,
    height: 1080,
    raw_payload_json: "{}",
    is_downloadable: true,
    skip_reason: "",
    fetched_at: "2026-04-11T00:00:00.000Z",
    ...overrides
  };
}

describe("buildArchiveWorkPlan", () => {
  it("dedupes downloadable rows and strips organizer extras", () => {
    const downloadableRow = createRow();
    const duplicateRow = createRow({
      row_id: "profile:s_alpha123:duplicate",
      title: "Nebula Run Duplicate"
    });
    const skippedRow = createRow({
      row_id: "drafts:missing",
      video_id: "",
      is_downloadable: false,
      skip_reason: "unresolved_draft_video_id"
    });

    const plan = buildArchiveWorkPlan([downloadableRow, duplicateRow, skippedRow], "Sora Library: April 2026");

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.video_id).toBe("s_alpha123");
    expect(plan.rows[0]?.archive_path).toBe("Sora Library- April 2026/me/published/posts/watermark/s_alpha123");
    expect(plan.rows[0]?.archive_variant).toBe("watermark");
    expect(plan.rows[0]?.archive_download_url).toBe("https://videos.openai.com/raw.mp4");
    expect(plan.archive_name).toBe("Sora Library- April 2026");
    expect(plan.organizer_rows).toEqual([]);
    expect(plan.supplemental_entries).toEqual([]);
  });

  it("keeps unique downloadable ids only", () => {
    const plan = buildArchiveWorkPlan([
      createRow({ row_id: "a", video_id: "s_one" }),
      createRow({ row_id: "b", video_id: "s_two" }),
      createRow({ row_id: "c", video_id: "s_one" })
    ], "Sora");

    expect(plan.rows.map((row) => row.video_id)).toEqual(["s_one", "s_two"]);
  });

  it("prefers no-watermark URLs and places rows in variant folders", () => {
    const noWatermarkRow = createRow({
      source_type: "likes",
      source_bucket: "liked",
      video_id: "s_nowm",
      playback_url: "https://videos.openai.com/watermark.mp4",
      download_url: "https://videos.openai.com/no-watermark.mp4",
      raw_payload_json: JSON.stringify({
        download_urls: {
          watermark: "https://videos.openai.com/watermark.mp4",
          no_watermark: "https://videos.openai.com/no-watermark.mp4"
        }
      })
    });

    const plan = buildArchiveWorkPlan([noWatermarkRow], "Sora");
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.archive_variant).toBe("no-watermark");
    expect(plan.rows[0]?.archive_download_url).toBe("https://videos.openai.com/no-watermark.mp4");
    expect(plan.rows[0]?.archive_path).toBe("Sora/liked/no-watermark/s_nowm");
  });

  it("maps side character rows into side-characters/{name}/{variant}", () => {
    const sideCharacterRow = createRow({
      source_type: "sideCharacter",
      source_bucket: "character-account",
      character_name: "Crystal Sparkle",
      video_id: "s_side123",
      playback_url: "https://videos.openai.com/wm-side.mp4",
      download_url: "https://videos.openai.com/wm-side.mp4"
    });

    const plan = buildArchiveWorkPlan([sideCharacterRow], "Sora");
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.archive_path).toBe("Sora/side-characters/Crystal Sparkle/watermark/s_side123");
  });
});
