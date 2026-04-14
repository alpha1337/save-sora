import { describe, expect, it } from "vitest";
import type { FetchJob } from "./source-adapters";
import { applyCharacterRowContext, filterRowsForCharacterScope } from "./character-row-scope";

const CHARACTER_APPEARANCES_JOB: FetchJob = {
  id: "character-account-appearances:ch_crystal",
  label: "Crystal Sparkle appearances",
  source: "characterAccountAppearances",
  expected_total_count: 100,
  character_id: "ch_crystal",
  creator_username: "crystal.party"
};

describe("character-row-scope", () => {
  it("passes through non-character sources without filtering", () => {
    const nonCharacterJob: FetchJob = {
      id: "likes",
      label: "Liked posts",
      source: "likes",
      expected_total_count: null
    };
    const rows = [{ post: { id: "s_1" } }, { post: { id: "s_2" } }];

    const filteredRows = filterRowsForCharacterScope(rows, nonCharacterJob);

    expect(filteredRows).toEqual(rows);
  });

  it("filters out false-positive appearance rows that are not tagged to the selected character", () => {
    const rows = [
      { post: { id: "s_false_positive" }, creator: { username: "alpha1337" } },
      { post: { id: "s_true_positive" }, cameo_profiles: [{ user_id: "ch_crystal", username: "crystal.party" }] }
    ];

    const filteredRows = filterRowsForCharacterScope(rows, CHARACTER_APPEARANCES_JOB);

    expect(filteredRows).toHaveLength(1);
    expect((filteredRows[0] as { post: { id: string } }).post.id).toBe("s_true_positive");
  });

  it("does not match username-only rows without ch_* metadata", () => {
    const rows = [
      { post: { id: "s_with_username" }, character_username: "crystal.party" },
      { post: { id: "s_with_other_username" }, character_username: "someone.else" }
    ];

    const filteredRows = filterRowsForCharacterScope(rows, CHARACTER_APPEARANCES_JOB);

    expect(filteredRows).toHaveLength(0);
  });

  it("does not match mention-only rows that are missing explicit character metadata", () => {
    const rows = [
      { post: { id: "s_with_mention_only" }, prompt: "@crystal.party check this out" },
      { post: { id: "s_with_explicit_id" }, cameo_profiles: [{ user_id: "ch_crystal" }] }
    ];

    const filteredRows = filterRowsForCharacterScope(rows, CHARACTER_APPEARANCES_JOB);

    expect(filteredRows).toHaveLength(1);
    expect((filteredRows[0] as { post: { id: string } }).post.id).toBe("s_with_explicit_id");
  });

  it("returns no rows when a character-scoped job id is not ch_*", () => {
    const nonCharacterJob: FetchJob = {
      ...CHARACTER_APPEARANCES_JOB,
      id: "character-account-appearances:user_owner_1",
      character_id: "user_owner_1"
    };
    const rows = [{ post: { id: "s_with_explicit_id" }, cameo_profiles: [{ user_id: "ch_crystal" }] }];

    const filteredRows = filterRowsForCharacterScope(rows, nonCharacterJob);

    expect(filteredRows).toHaveLength(0);
  });

  it("applies character context only after scoping", () => {
    const filteredRows = filterRowsForCharacterScope(
      [{ post: { id: "s_true_positive" }, cameo_profiles: [{ user_id: "ch_crystal" }] }],
      CHARACTER_APPEARANCES_JOB
    );

    const contextualizedRows = applyCharacterRowContext(filteredRows, CHARACTER_APPEARANCES_JOB) as Array<Record<string, unknown>>;

    expect(contextualizedRows).toHaveLength(1);
    expect(contextualizedRows[0].character_id).toBe("ch_crystal");
    expect(contextualizedRows[0].__character_context_display_name).toBe("Crystal Sparkle");
  });
});
