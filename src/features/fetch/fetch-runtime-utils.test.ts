import { describe, expect, it } from "vitest";
import { shouldStopForNoGrowthPages, shouldStopForStalledCursor } from "./fetch-runtime-utils";

describe("fetch-runtime-utils draft parity guards", () => {
  it("never stalls cursor pagination early for draft-like sources", () => {
    expect(shouldStopForStalledCursor(99, "drafts")).toBe(false);
    expect(shouldStopForStalledCursor(99, "characterDrafts")).toBe(false);
    expect(shouldStopForStalledCursor(99, "characterAccountDrafts")).toBe(false);
    expect(shouldStopForStalledCursor(99, "likes")).toBe(false);
    expect(shouldStopForStalledCursor(2, "profile")).toBe(true);
  });

  it("never stops no-growth pagination early for draft-like sources", () => {
    expect(shouldStopForNoGrowthPages(99, 0, "drafts")).toBe(false);
    expect(shouldStopForNoGrowthPages(99, 0, "characterDrafts")).toBe(false);
    expect(shouldStopForNoGrowthPages(99, 0, "characterAccountDrafts")).toBe(false);
    expect(shouldStopForNoGrowthPages(99, 0, "likes")).toBe(false);
    expect(shouldStopForNoGrowthPages(3, 0, "profile")).toBe(true);
  });
});
