import { describe, expect, it } from "vitest";
import { normalizeCreatorProfileInput } from "./creator-profile-input";

describe("normalizeCreatorProfileInput", () => {
  it("accepts a bare creator handle", () => {
    expect(normalizeCreatorProfileInput("creator.sample")).toBe("https://sora.chatgpt.com/profile/creator.sample");
  });

  it("accepts a prefixed handle", () => {
    expect(normalizeCreatorProfileInput("@creator.sample")).toBe("https://sora.chatgpt.com/profile/creator.sample");
  });

  it("accepts a full Sora profile URL", () => {
    expect(normalizeCreatorProfileInput("https://sora.chatgpt.com/profile/creator.sample")).toBe(
      "https://sora.chatgpt.com/profile/creator.sample"
    );
  });

  it("rejects non-Sora hosts", () => {
    expect(() => normalizeCreatorProfileInput("https://example.com/profile/creator.sample")).toThrow(
      "Paste a Sora creator username or a sora.chatgpt.com profile link."
    );
  });
});
