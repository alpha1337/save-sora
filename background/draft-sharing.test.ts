import { describe, expect, it } from "vitest";
import { extractEstimatedSizeBytesFromResolvedRow, resolveExistingDraftVideoId, shouldSkipDraftRow } from "../injected/sources/source-runner";

describe("draft sharing guards", () => {
  it("skips errored drafts", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_error",
        kind: "sora_error"
      })
    ).toBe(true);
  });

  it("keeps revision drafts eligible", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_edit",
        kind: "sora_draft",
        c_version: 1
      })
    ).toBe(false);
  });

  it("skips remix/editor stubs", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_remix_stub",
        kind: "sora_draft",
        remix_stub: true
      })
    ).toBe(true);
  });

  it("skips blocked drafts", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_blocked",
        kind: "sora_draft",
        output_blocked: true
      })
    ).toBe(true);
  });

  it("keeps plain sora drafts eligible for sharing", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_ok",
        kind: "sora_draft"
      })
    ).toBe(false);
  });

  it("reuses an existing shared draft url instead of creating a new share", () => {
    expect(
      resolveExistingDraftVideoId({
        id: "gen_shared",
        resolved_share_url: "https://sora.chatgpt.com/p/s_existing123"
      })
    ).toBe("s_existing123");
  });

  it("prefers an output shared id over remix source ids", () => {
    expect(
      resolveExistingDraftVideoId({
        id: "gen_remix_out",
        attachments: [
          {
            id: "s_source_video",
            kind: "source"
          },
          {
            kind: "output",
            share_url: "https://sora.chatgpt.com/p/s_generated_out"
          }
        ]
      })
    ).toBe("s_generated_out");
  });

  it("does not treat remix source references as already-resolved output ids", () => {
    expect(
      resolveExistingDraftVideoId({
        id: "gen_remix_source_only",
        creation_config: {
          remix_target_post: {
            post: {
              id: "s_source_only"
            }
          }
        },
        post: null
      })
    ).toBe("");
  });

  it("extracts resolved s_* file size from listing payload rows", () => {
    const payload = {
      posts: [
        {
          id: "s_other",
          attachments: [{ file_size: 12345 }]
        },
        {
          id: "s_resolved123",
          attachments: [
            {
              encodings: {
                source: { size: 9_876_543 }
              }
            }
          ]
        }
      ]
    };

    expect(extractEstimatedSizeBytesFromResolvedRow(payload, "s_resolved123")).toBe(9_876_543);
  });
});
