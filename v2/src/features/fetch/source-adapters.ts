import type { CreatorProfile, LowLevelSourceType } from "types/domain";
import type { AppStoreState } from "types/store";

export interface FetchJob {
  id: string;
  label: string;
  source: LowLevelSourceType;
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
    jobs.push({ id: "profile", label: "Published posts", source: "profile" });
  }
  if (selectedSources.drafts) {
    jobs.push({ id: "drafts", label: "Drafts", source: "drafts" });
  }
  if (selectedSources.likes) {
    jobs.push({ id: "likes", label: "Liked posts", source: "likes" });
  }
  if (selectedSources.characters) {
    jobs.push({ id: "characters-posts", label: "Character appearances", source: "characters" });
    jobs.push({ id: "characters-drafts", label: "Character drafts", source: "characterDrafts" });
  }
  if (selectedSources.characterAccounts) {
    for (const characterId of state.session_meta.selected_character_account_ids) {
      jobs.push({
        id: `character-account-posts:${characterId}`,
        label: `Character posts ${characterId}`,
        source: "characterAccountPosts",
        character_id: characterId
      });
      jobs.push({
        id: `character-account-appearances:${characterId}`,
        label: `Character appearances ${characterId}`,
        source: "characterAccountAppearances",
        character_id: characterId
      });
      jobs.push({
        id: `character-account-drafts:${characterId}`,
        label: `Character drafts ${characterId}`,
        source: "characterAccountDrafts",
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
        id: `creator-character-posts:${profile.profile_id}`,
        label: `${profile.display_name} posts`,
        source: "characterAccountPosts",
        character_id: profile.user_id,
        route_url: profile.permalink
      },
      {
        id: `creator-character-appearances:${profile.profile_id}`,
        label: `${profile.display_name} appearances`,
        source: "characterAccountAppearances",
        character_id: profile.user_id,
        route_url: profile.permalink
      },
      {
        id: `creator-character-drafts:${profile.profile_id}`,
        label: `${profile.display_name} drafts`,
        source: "characterAccountDrafts",
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
      ...baseJobData
    },
    {
      id: `creator-cameos:${profile.profile_id}`,
      label: `${profile.display_name} cameos`,
      source: "creatorCameos",
      ...baseJobData
    },
    {
      id: `creator-characters:${profile.profile_id}`,
      label: `${profile.display_name} characters`,
      source: "creatorCharacters",
      ...baseJobData
    }
  ];
}
