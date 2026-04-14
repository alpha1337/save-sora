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
    expect(row.row_id).toMatch(/^profile:/);
  });

  it("prefers thumbnail_url over preview_image_url for card thumbnails to match 1.x", () => {
    const [row] = normalizePostRows(
      "profile",
      [
        {
          id: "s_thumbprio1",
          discovery_phrase: "thumbnail priority",
          preview_image_url: "https://ogimg.chatgpt.com/?postId=s_thumbprio1",
          thumbnail_url: "https://videos.openai.com/thumb-attachment.jpg",
          attachments: [{ downloadable_url: "https://videos.openai.com/raw.mp4" }]
        }
      ],
      FETCHED_AT
    );

    expect(row.thumbnail_url).toBe("https://videos.openai.com/thumb-attachment.jpg");
  });

  it("uses attachment encodings thumbnail path when present", () => {
    const [row] = normalizePostRows(
      "profile",
      [
        {
          id: "s_thumbenc1",
          discovery_phrase: "attachment encoding thumbnail",
          attachments: [
            {
              encodings: {
                thumbnail: {
                  path: "https://videos.openai.com/az/files/post-7/drvs/thumbnail/raw"
                }
              }
            }
          ]
        }
      ],
      FETCHED_AT
    );

    expect(row.thumbnail_url).toBe("https://videos.openai.com/az/files/post-7/drvs/thumbnail/raw");
  });

  it("prefers attachment thumbnail path over row-level preview image", () => {
    const [row] = normalizePostRows(
      "profile",
      [
        {
          id: "s_thumbattach1",
          preview_image_url: "https://ogimg.chatgpt.com/?postId=s_thumbattach1",
          attachments: [
            {
              encodings: {
                thumbnail: {
                  path: "https://videos.openai.com/az/files/post-8/drvs/thumbnail/raw"
                }
              }
            }
          ]
        }
      ],
      FETCHED_AT
    );

    expect(row.thumbnail_url).toBe("https://videos.openai.com/az/files/post-8/drvs/thumbnail/raw");
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

    expect(row.row_id).toMatch(/^drafts:/);
    expect(row.video_id).toBe("s_final999");
    expect(row.is_downloadable).toBe(true);
    expect(row.skip_reason).toBe("");
    expect(row.detail_url).toBe("https://sora.chatgpt.com/p/s_final999");
  });

  it("estimates draft file size from duration and dimensions when explicit size is unavailable", () => {
    const [row] = normalizeDraftRows(
      "drafts",
      [
        {
          id: "gen_alpha124",
          prompt: "A neon city reveal",
          resolved_video_id: "s_final998",
          attachments: [
            {
              duration_s: 10,
              width: 1920,
              height: 1080
            }
          ]
        }
      ],
      FETCHED_AT
    );

    expect(row.estimated_size_bytes).toBe(10_000_000);
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
          },
          cameo_profiles: [
            {
              user_id: "ch_crystal",
              username: "creator.sample",
              display_name: "Crystal Sparkle"
            },
            {
              user_id: "user_not_character",
              username: "ignored-poster",
              display_name: "Ignored Poster"
            }
          ]
        }
      ],
      FETCHED_AT
    );

    expect(row).toMatchObject({
      video_id: "s_nested123",
      title: "wii nostalgia aesthetic",
      creator_name: "Muhammad Ali",
      creator_username: "muhammad_f_ali",
      character_name: "Crystal Sparkle",
      character_username: "creator.sample",
      duration_seconds: 9.8,
      width: 352,
      height: 640,
      view_count: 13,
      is_downloadable: true,
      skip_reason: ""
    });
    expect(row.row_id).toMatch(/^characterAccountAppearances:/);
    expect(row.character_names).toEqual(["Crystal Sparkle"]);
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

  it("extracts all @mention usernames into character_names for cameo rows", () => {
    const [row] = normalizePostRows(
      "characters",
      [
        {
          post: {
            id: "s_mentions123",
            text: "@laurajardin @caseyjardin @dnancy33 cast us with characters",
            attachments: [{ downloadable_url: "https://videos.openai.com/raw.mp4" }]
          },
          profile: {
            display_name: "Laura Jardin",
            username: "laurajardin"
          }
        }
      ],
      FETCHED_AT
    );

    expect(row.character_names).toEqual(["laurajardin", "caseyjardin", "dnancy33"]);
    expect(row.character_name).toBe("laurajardin");
  });

  it("maps mention facets to character usernames for creator cameo sources", () => {
    const [row] = normalizePostRows(
      "creatorCameos",
      [
        {
          post: {
            id: "s_mentionsFacet1",
            text: "cast us in wonderland",
            text_facets: [
              { type: "mention", profile: { username: "laurajardin" } },
              { type: "mention", profile: { username: "caseyjardin" } },
              { type: "mention", profile: { username: "dnancy33" } }
            ],
            attachments: [{ downloadable_url: "https://videos.openai.com/raw.mp4" }]
          }
        }
      ],
      FETCHED_AT
    );

    expect(row.character_names).toEqual(["laurajardin", "caseyjardin", "dnancy33"]);
    expect(row.character_name).toBe("laurajardin");
  });

  it("never uses a video id as the fallback title for posts", () => {
    const [row] = normalizePostRows(
      "creatorPublished",
      [
        {
          id: "s_fallback123",
          attachments: [{ downloadable_url: "https://videos.openai.com/raw.mp4" }]
        }
      ],
      FETCHED_AT
    );

    expect(row.title).toBe("video");
    expect(row.video_id).toBe("s_fallback123");
    expect(row.skip_reason).toBe("");
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

  it("never uses a generation id as a draft fallback title", () => {
    const [row] = normalizeDraftRows(
      "drafts",
      [
        {
          id: "gen_fallback123",
          prompt: "Draft without resolved id",
          attachments: [{ duration_s: 9.8 }]
        }
      ],
      FETCHED_AT
    );

    expect(row.title).toBe("Draft without resolved id");
    expect(row.video_id).toBe("");
    expect(row.skip_reason).toBe("unresolved_draft_video_id");
  });

  it("falls back to the draft downloadable url when no shared s_* id is available", () => {
    const [row] = normalizeDraftRows(
      "characterAccountDrafts",
      [
        {
          id: "gen_fallback_dl_123",
          prompt: "Shared cameo draft",
          attachments: [{ downloadable_url: "https://videos.openai.com/draft-fallback.mp4" }]
        }
      ],
      FETCHED_AT
    );

    expect(row.video_id).toBe("gen_fallback_dl_123");
    expect(row.playback_url).toBe("https://videos.openai.com/draft-fallback.mp4");
    expect(row.is_downloadable).toBe(true);
    expect(row.skip_reason).toBe("");
  });

  it("prefers remix output attachments over source/reference attachments for draft playback", () => {
    const [row] = normalizeDraftRows(
      "drafts",
      [
        {
          id: "gen_remix123",
          prompt: "My remix draft",
          attachments: [
            {
              id: "s_source_other_user",
              kind: "source",
              downloadable_url: "https://videos.openai.com/remix-source.mp4"
            },
            {
              id: "gen_remix123",
              kind: "output",
              downloadable_url: "https://videos.openai.com/remix-output.mp4"
            }
          ]
        }
      ],
      FETCHED_AT
    );

    expect(row.video_id).toBe("gen_remix123");
    expect(row.playback_url).toBe("https://videos.openai.com/remix-output.mp4");
    expect(row.is_downloadable).toBe(true);
    expect(row.skip_reason).toBe("");
  });

  it("ignores resolved draft ids that only match source attachments", () => {
    const [row] = normalizeDraftRows(
      "drafts",
      [
        {
          id: "gen_remix456",
          resolved_video_id: "s_source_only",
          attachments: [
            {
              id: "s_source_only",
              kind: "source",
              downloadable_url: "https://videos.openai.com/remix-source.mp4"
            },
            {
              id: "gen_remix456",
              kind: "output",
              downloadable_url: "https://videos.openai.com/remix-output.mp4"
            }
          ]
        }
      ],
      FETCHED_AT
    );

    expect(row.video_id).toBe("gen_remix456");
    expect(row.playback_url).toBe("https://videos.openai.com/remix-output.mp4");
    expect(row.is_downloadable).toBe(true);
  });

  it("uses fetch-job character context for characterAccountDrafts when row lacks character fields", () => {
    const [row] = normalizeDraftRows(
      "characterAccountDrafts",
      [
        {
          id: "gen_context123",
          __character_context_display_name: "Mordex",
          prompt: "Draft without explicit character metadata"
        }
      ],
      FETCHED_AT
    );

    expect(row.character_name).toBe("Mordex");
    expect(row.character_names).toEqual(["Mordex"]);
  });

  it("uses nested draft metadata for characterAccountDrafts wrapper rows", () => {
    const [row] = normalizeDraftRows(
      "characterAccountDrafts",
      [
        {
          profile: {
            display_name: "alpha1337",
            username: "caseyjardin"
          },
          draft: {
            id: "gen_nested_meta_123",
            prompt: "Nested draft prompt",
            downloadable_url: "https://videos.openai.com/nested-draft.mp4",
            encodings: {
              thumbnail: {
                path: "https://videos.openai.com/nested-thumb.jpg"
              }
            },
            creation_config: {
              cameo_profiles: [
                {
                  user_id: "ch_alf",
                  display_name: "A.L.F.",
                  username: "alf"
                }
              ]
            }
          }
        }
      ],
      FETCHED_AT
    );

    expect(row.video_id).toBe("gen_nested_meta_123");
    expect(row.prompt).toBe("Nested draft prompt");
    expect(row.playback_url).toBe("https://videos.openai.com/nested-draft.mp4");
    expect(row.thumbnail_url).toBe("https://videos.openai.com/nested-thumb.jpg");
    expect(row.creator_name).toBe("alpha1337");
    expect(row.creator_username).toBe("caseyjardin");
    expect(row.character_name).toBe("A.L.F.");
    expect(row.character_username).toBe("alf");
  });

  it("prefers nested draft prompt over wrapper prompt", () => {
    const [row] = normalizeDraftRows(
      "characterAccountDrafts",
      [
        {
          prompt: "Wrapper prompt",
          draft: {
            id: "gen_nested_prompt_123",
            prompt: "Inner draft prompt",
            downloadable_url: "https://videos.openai.com/inner-draft.mp4"
          }
        }
      ],
      FETCHED_AT
    );

    expect(row.prompt).toBe("Inner draft prompt");
    expect(row.video_id).toBe("gen_nested_prompt_123");
  });

  it("keeps missing-id posts distinct when payload differs", () => {
    const [first, second] = normalizePostRows(
      "profile",
      [
        {
          post: {
            id: "",
            discovery_phrase: "shared title",
            attachments: [{ downloadable_url: "https://videos.openai.com/one.mp4" }],
            thumbnail_url: "https://videos.openai.com/thumb1.jpg"
          }
        },
        {
          post: {
            id: "",
            discovery_phrase: "shared title",
            attachments: [{ downloadable_url: "https://videos.openai.com/two.mp4" }],
            thumbnail_url: "https://videos.openai.com/thumb2.jpg"
          }
        }
      ],
      FETCHED_AT
    );

    expect(first.row_id).toBeDefined();
    expect(second.row_id).toBeDefined();
    expect(first.row_id).not.toBe(second.row_id);
    expect(first.skip_reason).toBe("missing_video_id");
    expect(second.skip_reason).toBe("missing_video_id");
  });

  it("keeps missing-id posts deterministic for identical payloads", () => {
    const payload = {
      post: {
        id: "",
        discovery_phrase: "deterministic title",
        attachments: [{ downloadable_url: "https://videos.openai.com/deterministic.mp4" }]
      }
    };
    const [first] = normalizePostRows("profile", [payload], FETCHED_AT);
    const [second] = normalizePostRows("profile", [payload], FETCHED_AT);

    expect(first.row_id).toBe(second.row_id);
  });

  it("preserves character-profile flags when normalizing creator profiles", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        is_character_profile: true
      },
      "https://sora.chatgpt.com/profile/creator.sample"
    );

    expect(profile).toMatchObject({
      user_id: "ch_crystal",
      is_character_profile: true,
      published_count: null,
      appearance_count: null
    });
  });

  it("keeps creator and character ids distinct when payloads expose both ids", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "user_creator.alt",
        character_user_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle"
      },
      "https://sora.chatgpt.com/profile/creator.sample"
    );

    expect(profile).toMatchObject({
      user_id: "user_creator.alt",
      owner_user_id: "user_creator.alt",
      character_user_id: "ch_crystal",
      is_character_profile: true
    });
  });

  it("preserves profile count metrics for progress estimation", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "user_creator.alt",
        username: "creator.alt",
        display_name: "Binary Rot",
        post_count: 3018,
        cameo_count: 2535
      },
      "https://sora.chatgpt.com/profile/creator.alt"
    );

    expect(profile).toMatchObject({
      published_count: 3018,
      appearance_count: 2535,
      draft_count: null
    });
  });

  it("reads appearance counts from owner profile payloads", () => {
    const profile = normalizeCreatorProfile(
      {
        user_id: "ch_crystal",
        username: "creator.sample",
        display_name: "Crystal Sparkle",
        owner_profile: {
          user_id: "user_bobby",
          username: "notbobbylee",
          cameo_count: 143852
        }
      },
      "https://sora.chatgpt.com/profile/creator.sample"
    );

    expect(profile).toMatchObject({
      user_id: "ch_crystal",
      appearance_count: 143852,
      is_character_profile: true
    });
  });
});
