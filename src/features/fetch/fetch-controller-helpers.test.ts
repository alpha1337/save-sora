import { describe, expect, it } from "vitest";
import { getFetchBatchLimit, mergeRefreshedCreatorProfile, shouldRefreshCreatorProfile } from "./fetch-controller-helpers";

describe("fetch-controller-helpers", () => {
  it("preserves likes fetch limit", () => {
    expect(getFetchBatchLimit("likes", 100, 100, 8)).toBe(100);
    expect(getFetchBatchLimit("likes", 6, 100, 8)).toBe(6);
  });

  it("keeps existing limits for other sources", () => {
    expect(getFetchBatchLimit("profile", 100, 100, 8)).toBe(100);
    expect(getFetchBatchLimit("characters", 100, 100, 8)).toBe(100);
    expect(getFetchBatchLimit("drafts", 100, 100, 8)).toBe(100);
    expect(getFetchBatchLimit("creatorCameos", 100, 100, 8)).toBe(100);
  });

  it("uses side-character override without changing other character sources", () => {
    expect(getFetchBatchLimit("characterAccountAppearances", 100, 8, 8)).toBe(8);
    expect(getFetchBatchLimit("sideCharacter", 100, 8, 8)).toBe(8);
    expect(getFetchBatchLimit("characterAccountDrafts", 100, 8, 8)).toBe(100);
  });

  it("always refreshes saved creator profiles before fetch", () => {
    expect(
      shouldRefreshCreatorProfile({
        permalink: "https://sora.chatgpt.com/profile/crystal.party",
        user_id: "user-legacy-profile",
        is_character_profile: false,
        appearance_count: 143852,
        published_count: 1086
      })
    ).toBe(true);

    expect(
      shouldRefreshCreatorProfile({
        permalink: "",
        user_id: "user-legacy-profile",
        is_character_profile: false,
        appearance_count: 143852,
        published_count: 1086
      })
    ).toBe(false);
  });

  it("preserves side-character fetch intent after profile refresh", () => {
    const mergedProfile = mergeRefreshedCreatorProfile(
      {
        profile_id: "profile-crystal",
        user_id: "ch_legacy_crystal",
        owner_user_id: "user-owner-legacy",
        character_user_id: "ch_legacy_crystal",
        account_type: "sideCharacter",
        username: "crystal.party",
        display_name: "Crystal Sparkle",
        permalink: "https://sora.chatgpt.com/profile/crystal.party",
        profile_picture_url: null,
        is_character_profile: true,
        published_count: null,
        appearance_count: 240,
        draft_count: null,
        created_at: "2026-04-21T00:00:00.000Z"
      },
      {
        profile_id: "profile-crystal-refreshed",
        user_id: "user-owner-refreshed",
        owner_user_id: "",
        character_user_id: "",
        account_type: "creator",
        username: "crystal.party",
        display_name: "Crystal Sparkle",
        permalink: "https://sora.chatgpt.com/profile/crystal.party",
        profile_picture_url: null,
        is_character_profile: false,
        published_count: 100,
        appearance_count: 300,
        draft_count: 0,
        created_at: "2026-04-21T00:05:00.000Z"
      }
    );

    expect(mergedProfile.profile_id).toBe("profile-crystal");
    expect(mergedProfile.account_type).toBe("sideCharacter");
    expect(mergedProfile.is_character_profile).toBe(true);
    expect(mergedProfile.character_user_id).toBe("ch_legacy_crystal");
    expect(mergedProfile.owner_user_id).toBe("user-owner-legacy");
  });
});
