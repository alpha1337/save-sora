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
    character_names: ["Nova", "Nova"],
    category_tags: ["published", "featured", "featured"],
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
  it("stores each downloadable row once and emits organizer targets deterministically", () => {
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
    expect(plan.archive_name).toBe("Sora Library- April 2026");
    expect(plan.organizer_rows).toHaveLength(1);
    expect(plan.organizer_rows[0]).toMatchObject({
      video_id: "s_alpha123",
      library_path: "library/space dogfight-s_alpha123.mp4"
    });
    expect(plan.organizer_rows[0].link_paths).toEqual([
      "organized/by-category/featured/space dogfight-s_alpha123.mp4",
      "organized/by-category/published/space dogfight-s_alpha123.mp4",
      "organized/by-character/Nova/space dogfight-s_alpha123.mp4",
      "organized/by-creator/Alex Mercer/space dogfight-s_alpha123.mp4",
      "organized/by-source/profile/space dogfight-s_alpha123.mp4"
    ]);

    expect(plan.supplemental_entries.map((entry) => entry.archive_path)).toEqual([
      "organizer/link-manifest.json",
      "organizer/create-links-macos.sh",
      "organizer/Install Organizer.command",
      "organizer/create-links-windows.ps1",
      "organizer/Run Organizer.bat",
      "organizer/README.txt"
    ]);
  });

  it("falls back to character.creator.id when discovery phrase is missing", () => {
    const row = createRow({
      discovery_phrase: "",
      character_username: "freakymrc",
      creator_username: "saintglimm",
      title: "Very long title that should never be used when discovery phrase is unavailable"
    });

    const plan = buildArchiveWorkPlan([row], "Sora Library");
    expect(plan.organizer_rows[0].file_name).toBe("freakymrc.saintglimm-s_alpha123.mp4");
  });

  it("truncates discovery phrase stems to keep Windows-safe filename lengths", () => {
    const row = createRow({
      discovery_phrase: "a".repeat(120)
    });

    const plan = buildArchiveWorkPlan([row], "Sora Library");
    expect(plan.organizer_rows[0].file_name).toBe(`${"a".repeat(48)}-s_alpha123.mp4`);
  });
});
