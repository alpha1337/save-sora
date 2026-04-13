import { describe, expect, it } from "vitest";
import { getUserFacingErrorMessage } from "./user-facing-errors";

describe("getUserFacingErrorMessage", () => {
  it("maps watermark removal rate limits", () => {
    const message = getUserFacingErrorMessage("soraVDL download failed for s_abc with status 429.");
    expect(message).toContain("Watermark removal is being rate-limited");
  });

  it("maps raw sora 400 status", () => {
    const message = getUserFacingErrorMessage("Sora request failed with status 400.");
    expect(message).toContain("Sora rejected this request");
  });

  it("strips internal provider mentions", () => {
    const message = getUserFacingErrorMessage("soravdl gateway timeout");
    expect(message.toLowerCase()).not.toContain("soravdl");
    expect(message).toContain("Watermark removal is temporarily unavailable");
  });
});
