import { describe, expect, it } from "vitest";
import { getUserFacingErrorMessage } from "./user-facing-errors";

describe("getUserFacingErrorMessage", () => {
  it("maps source download rate limits", () => {
    const message = getUserFacingErrorMessage("Source video download failed (status 429).");
    expect(message).toContain("rate-limiting file downloads");
  });

  it("maps raw sora 400 status", () => {
    const message = getUserFacingErrorMessage("Sora request failed with status 400.");
    expect(message).toContain("Sora rejected this request");
  });

  it("maps sora network failures with attempt counts", () => {
    const message = getUserFacingErrorMessage(
      "Sora request failed due to a network error after 12 attempts. Request: GET /backend/project_y/profile_feed/ch_123?cut=appearances&limit=8&cursor=abc123. Context: job=Crystal Sparkle appearances · source=sideCharacter · batch=731 · endpoint=side-character-feed-appearances"
    );
    expect(message).toContain("Sora could not be reached after 12 attempts");
    expect(message).toContain("Debug:");
    expect(message).toContain("source=sideCharacter");
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

  it("maps source download server errors", () => {
    const message = getUserFacingErrorMessage("Source video download failed (status 500).");
    expect(message).toContain("Video download is temporarily unavailable");
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

  it("normalizes cancellation messages without debug context", () => {
    const message = getUserFacingErrorMessage(
      "Fetch canceled. Context: job=Binary Rot published · source=creatorPublished · batch=144 · endpoint=creator-feed-nf2"
    );
    expect(message).toBe("Fetch canceled.");
  });
});
