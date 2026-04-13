import { describe, expect, it } from "vitest";
import { normalizeCreatorProfileInput } from "./creator-profile-input";

describe("normalizeCreatorProfileInput", () => {
  it("accepts a bare creator handle", () => {
    expect(normalizeCreatorProfileInput("crystal.party")).toBe("https://sora.chatgpt.com/profile/crystal.party");
  });

  it("accepts a prefixed handle", () => {
    expect(normalizeCreatorProfileInput("@crystal.party")).toBe("https://sora.chatgpt.com/profile/crystal.party");
  });

  it("accepts a full Sora profile URL", () => {
    expect(normalizeCreatorProfileInput("https://sora.chatgpt.com/profile/crystal.party")).toBe(
      "https://sora.chatgpt.com/profile/crystal.party"
    );
  });

  it("rejects non-Sora hosts", () => {
    expect(() => normalizeCreatorProfileInput("https://example.com/profile/crystal.party")).toThrow(
      "Paste a Sora creator username or a sora.chatgpt.com profile link."
    );
  });
});
