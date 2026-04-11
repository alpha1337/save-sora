import type { CreatorProfile, LowLevelSourceType } from "types/domain";
import type { AppStoreState } from "types/store";

export interface FetchJob {
  id: string;
  label: string;
  source: LowLevelSourceType;
  expected_total_count: number | null;
  route_url?: string;
  creator_user_id?: string;
  creator_username?: string;
  character_id?: string;
}

/**
 * Converts the current app state into a flat list of low-level fetch jobs.
 */
export function buildFetchJobs(state: AppStoreState): FetchJob[] {
  const jobs: FetchJob[] = [];
  const selectedSources = state.session_meta.active_sources;

  if (selectedSources.profile) {
    jobs.push({ id: "profile", label: "Published posts", source: "profile", expected_total_count: null });
  }
  if (selectedSources.drafts) {
    jobs.push({ id: "drafts", label: "Drafts", source: "drafts", expected_total_count: null });
  }
  if (selectedSources.likes) {
    jobs.push({ id: "likes", label: "Liked posts", source: "likes", expected_total_count: null });
  }
  if (selectedSources.characters) {
    jobs.push({ id: "characters-posts", label: "Character appearances", source: "characters", expected_total_count: null });
    jobs.push({ id: "characters-drafts", label: "Character drafts", source: "characterDrafts", expected_total_count: null });
  }
  if (selectedSources.characterAccounts) {
    for (const characterId of state.session_meta.selected_character_account_ids) {
      const account = state.character_accounts.find((entry) => entry.account_id === characterId);
      const labelPrefix = account?.display_name || account?.username || characterId;
      jobs.push({
        id: `character-account-appearances:${characterId}`,
        label: `${labelPrefix} appearances`,
        source: "characterAccountAppearances",
        expected_total_count: account?.appearance_count ?? null,
        character_id: characterId
      });
      jobs.push({
        id: `character-account-drafts:${characterId}`,
        label: `${labelPrefix} drafts`,
        source: "characterAccountDrafts",
        expected_total_count: account?.draft_count ?? null,
        character_id: characterId
      });
    }
  }
  if (selectedSources.creators) {
    for (const profile of state.creator_profiles) {
      jobs.push(...buildCreatorJobs(profile));
    }
  }

  return jobs;
}

function buildCreatorJobs(profile: CreatorProfile): FetchJob[] {
  const baseJobData = {
    creator_user_id: profile.user_id,
    creator_username: profile.username,
    route_url: profile.permalink
  };

  if (profile.is_character_profile && profile.user_id.startsWith("ch_")) {
    return [
      {
        id: `creator-character-appearances:${profile.profile_id}`,
        label: `${profile.display_name} appearances`,
        source: "characterAccountAppearances",
        expected_total_count: profile.appearance_count,
        character_id: profile.user_id,
        route_url: profile.permalink
      },
      {
        id: `creator-character-drafts:${profile.profile_id}`,
        label: `${profile.display_name} drafts`,
        source: "characterAccountDrafts",
        expected_total_count: profile.draft_count,
        character_id: profile.user_id,
        route_url: profile.permalink
      }
    ];
  }

  return [
    {
      id: `creator-published:${profile.profile_id}`,
      label: `${profile.display_name} published`,
      source: "creatorPublished",
      expected_total_count: profile.published_count,
      ...baseJobData
    },
    {
      id: `creator-cameos:${profile.profile_id}`,
      label: `${profile.display_name} cameos`,
      source: "creatorCameos",
      expected_total_count: profile.appearance_count,
      ...baseJobData
    }
  ];
}
