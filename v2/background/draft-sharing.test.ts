import { describe, expect, it } from "vitest";
import { resolveExistingDraftVideoId, shouldSkipDraftRow } from "../injected/sources/source-runner";

describe("draft sharing guards", () => {
  it("skips errored drafts", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_error",
        kind: "sora_error"
      })
    ).toBe(true);
  });

  it("skips edited drafts", () => {
    expect(
      shouldSkipDraftRow({
        id: "gen_edit",
        kind: "sora_draft",
        c_version: 1
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
});
