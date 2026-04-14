import { describe, expect, it } from "vitest";
import { getUserFacingErrorMessage } from "./user-facing-errors";

describe("getUserFacingErrorMessage", () => {
  it("maps watermark removal rate limits", () => {
    const message = getUserFacingErrorMessage("download failed for s_abc with status 429.");
    expect(message).toContain("Watermark removal is being rate-limited");
  });

  it("maps raw sora 400 status", () => {
    const message = getUserFacingErrorMessage("Sora request failed with status 400.");
    expect(message).toContain("Sora rejected this request");
  });

  it("includes request details for sora status mapping", () => {
    const message = getUserFacingErrorMessage(
      "Sora request failed with status 400. Request: GET /backend/project_y/profile_feed/me?cut=nf2&limit=100."
    );
    expect(message).toContain("Sora rejected this request");
    expect(message).toContain("Debug: GET /backend/project_y/profile_feed/me?cut=nf2&limit=100");
  });

  it("preserves debug context for rejected sora requests", () => {
    const message = getUserFacingErrorMessage(
      "Sora request failed with status 400. Context: job=Quiet Takes published · source=creatorPublished · batch=1 · endpoint=creator-published"
    );
    expect(message).toContain("Sora rejected this request");
    expect(message).toContain("Debug: job=Quiet Takes published");
    expect(message).toContain("endpoint=creator-published");
  });

  it("strips internal provider mentions", () => {
    const message = getUserFacingErrorMessage("proxy gateway timeout");
    expect(message).toContain("Watermark removal is temporarily unavailable");
  });

  it("does not duplicate context for pre-mapped rejection messages", () => {
    const message = getUserFacingErrorMessage(
      "Sora rejected this request. Context: job=Quiet Takes published · source=creatorPublished"
    );
    expect(message).toContain("Sora rejected this request.");
    expect(message).toContain("Debug: job=Quiet Takes published");
    expect(message).not.toContain("Context:");
  });

  it("preserves fetch-batch attempt diagnostics without remapping", () => {
    const message = getUserFacingErrorMessage(
      "Sora fetch-batch failed for source=creatorPublished. Attempts: creator-post-listing-posts (status 400) GET /backend/project_y/profile/user_123/post_listing/posts?limit=100."
    );
    expect(message).toContain("Sora fetch-batch failed for source=creatorPublished.");
    expect(message).toContain("creator-post-listing-posts (status 400)");
    expect(message).toContain("GET /backend/project_y/profile/user_123/post_listing/posts?limit=100");
  });
});
