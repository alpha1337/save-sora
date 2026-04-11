import { describe, expect, it } from "vitest";
import {
  extractVideoIdFromDetailHtml,
  normalizeCreatorProfile,
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

  it("normalizes nested post payloads from character appearance feeds", () => {
    const [row] = normalizePostRows(
      "characterAccountAppearances",
      [
        {
          post: {
            id: "s_nested123",
            discovery_phrase: "wii nostalgia aesthetic",
            posted_at: 1775636349.345291,
            permalink: "https://sora.chatgpt.com/p/s_nested123",
            view_count: 13,
            attachments: [
              {
                id: "s_nested123-attachment-0",
                duration_s: 9.8,
                width: 352,
                height: 640,
                downloadable_url: "https://videos.openai.com/az/files/00000000-a768-7284-afab-7268d9eb84af/raw"
              }
            ]
          },
          profile: {
            display_name: "Muhammad Ali",
            username: "muhammad_f_ali"
          }
        }
      ],
      FETCHED_AT
    );

    expect(row).toMatchObject({
      row_id: "characterAccountAppearances:s_nested123",
      video_id: "s_nested123",
      title: "wii nostalgia aesthetic",
      creator_name: "Muhammad Ali",
      creator_username: "muhammad_f_ali",
      duration_seconds: 9.8,
      width: 352,
      height: 640,
      view_count: 13,
      is_downloadable: true,
      skip_reason: ""
    });
    expect(row.published_at).toBe(new Date(1775636349.345291 * 1000).toISOString());
  });

  it("uses nested post text as the title fallback when discovery phrase is missing", () => {
    const [row] = normalizePostRows(
      "creatorPublished",
      [
        {
          post: {
            id: "s_prompt123",
            text: "Nested post title",
            attachments: [{ downloadable_url: "https://videos.openai.com/raw.mp4" }]
          }
        }
      ],
      FETCHED_AT
    );

    expect(row.title).toBe("Nested post title");
    expect(row.prompt).toBe("Nested post title");
  });

  it("prefers caption before description when both are present", () => {
    const [row] = normalizePostRows(
      "creatorPublished",
      [
        {
          post: {
            id: "s_caption123",
            caption: "Caption title",
            description: "Description title",
            attachments: [{ downloadable_url: "https://videos.openai.com/raw.mp4" }]
          }
        }
      ],
      FETCHED_AT
    );

    expect(row.title).toBe("Caption title");
    expect(row.caption).toBe("Caption title");
    expect(row.description).toBe("Description title");
  });

  it("preserves character-profile flags when normalizing creator profiles", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "ch_crystal",
        username: "crystal.party",
        display_name: "Crystal Sparkle",
        is_character_profile: true
      },
      "https://sora.chatgpt.com/profile/crystal.party"
    );

    expect(profile).toMatchObject({
      user_id: "ch_crystal",
      is_character_profile: true,
      published_count: null,
      appearance_count: null
    });
  });

  it("prefers a character user id when creator profile payloads expose both ids", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "user_binaryrot",
        character_user_id: "ch_crystal",
        username: "crystal.party",
        display_name: "Crystal Sparkle"
      },
      "https://sora.chatgpt.com/profile/crystal.party"
    );

    expect(profile).toMatchObject({
      user_id: "ch_crystal",
      is_character_profile: true
    });
  });

  it("preserves profile count metrics for progress estimation", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "user_binaryrot",
        username: "binaryrot",
        display_name: "Binary Rot",
        post_count: 3018,
        cameo_count: 2535
      },
      "https://sora.chatgpt.com/profile/binaryrot"
    );

    expect(profile).toMatchObject({
      published_count: 3018,
      appearance_count: 2535,
      draft_count: null
    });
  });
});
