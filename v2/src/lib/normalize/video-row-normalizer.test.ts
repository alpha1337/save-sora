import { describe, expect, it } from "vitest";
import {
  extractVideoIdFromDetailHtml,
  normalizeDraftRows,
  normalizePostRows
} from "./video-row-normalizer";

const FETCHED_AT = "2026-04-11T00:00:00.000Z";

describe("video-row-normalizer", () => {
  it("normalizes downloadable post rows into a stable shared schema", () => {
    const [row] = normalizePostRows(
      "profile",
      [
        {
          id: "s_alpha123",
          prompt: "A fox running across snowy dunes",
          discovery_phrase: "snow fox",
          description: "A fox running across snowy dunes",
          caption: "Snow Fox",
          creator: { display_name: "Jordan Lee", username: "jordan" },
          character_name: "Astra",
          thumbnail_url: "https://videos.openai.com/thumb.jpg",
          created_at: "2026-04-10T18:00:00.000Z",
          metrics: { likes: 12, views: 44, shares: 3, reposts: 1, remixes: 2 }
        }
      ],
      FETCHED_AT
    );

    expect(row).toMatchObject({
      row_id: "profile:s_alpha123",
      video_id: "s_alpha123",
      source_type: "profile",
      source_bucket: "published",
      title: "snow fox",
      prompt: "A fox running across snowy dunes",
      discovery_phrase: "snow fox",
      creator_name: "Jordan Lee",
      creator_username: "jordan",
      character_name: "Astra",
      is_downloadable: true,
      skip_reason: ""
    });
  });

  it("marks multi-attachment posts as skipped", () => {
    const [row] = normalizePostRows(
      "profile",
      [
        {
          id: "s_multi123",
          prompt: "A multi-shot post",
          attachments: [{ id: 1 }, { id: 2 }]
        }
      ],
      FETCHED_AT
    );

    expect(row.video_id).toBe("");
    expect(row.is_downloadable).toBe(false);
    expect(row.skip_reason).toBe("multi_attachment_unsupported");
  });

  it("normalizes draft rows using the resolved final video id", () => {
    const [row] = normalizeDraftRows(
      "drafts",
      [
        {
          id: "gen_alpha123",
          prompt: "A neon city reveal",
          resolved_video_id: "s_final999",
          resolved_share_url: "https://sora.chatgpt.com/p/s_final999"
        }
      ],
      FETCHED_AT
    );

    expect(row.row_id).toBe("drafts:s_final999");
    expect(row.video_id).toBe("s_final999");
    expect(row.is_downloadable).toBe(true);
    expect(row.skip_reason).toBe("");
    expect(row.detail_url).toBe("https://sora.chatgpt.com/p/s_final999");
  });

  it("extracts the final shared id from detail html fallbacks", () => {
    expect(extractVideoIdFromDetailHtml('<a href="/p/s_detail777">Open</a>')).toBe("s_detail777");
  });
});
