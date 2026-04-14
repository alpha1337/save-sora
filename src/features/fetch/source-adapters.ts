import type { CreatorProfile, LowLevelSourceType } from "types/domain";
import type { AppStoreState } from "types/store";

export interface FetchJob {
  id: string;
  label: string;
  source: LowLevelSourceType;
  expected_total_count: number | null;
  fetch_since_ms?: number | null;
  fetch_until_ms?: number | null;
  character_display_name?: string;
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
  const fetchWindow = resolveFetchWindowMs(state);

  if (selectedSources.profile) {
    jobs.push(withFetchWindow({ id: "profile", label: "Published posts", source: "profile", expected_total_count: null }, fetchWindow));
  }
  if (selectedSources.drafts) {
    jobs.push(withFetchWindow({ id: "drafts", label: "Drafts", source: "drafts", expected_total_count: null }, fetchWindow));
  }
  if (selectedSources.likes) {
    jobs.push(withFetchWindow({ id: "likes", label: "Liked posts", source: "likes", expected_total_count: null }, fetchWindow));
  }
  if (selectedSources.characters) {
    jobs.push(withFetchWindow({ id: "characters-posts", label: "Character appearances", source: "characters", expected_total_count: null }, fetchWindow));
    jobs.push(withFetchWindow({ id: "characters-drafts", label: "Character drafts", source: "characterDrafts", expected_total_count: null }, fetchWindow));
  }
  if (selectedSources.characterAccounts) {
    for (const characterId of state.session_meta.selected_character_account_ids) {
      if (!characterId.startsWith("ch_")) {
        continue;
      }
      const account = state.character_accounts.find((entry) => entry.account_id === characterId);
      const profileMatch = state.creator_profiles.find(
        (profile) =>
          profile.is_character_profile &&
          (profile.character_user_id === characterId || profile.user_id === characterId || profile.profile_id === characterId)
      );
      const labelPrefix = resolveCharacterLabel(account?.display_name, account?.username, profileMatch?.display_name, profileMatch?.username, characterId);
      jobs.push(withFetchWindow({
        id: `character-account-appearances:${characterId}`,
        label: `${labelPrefix} appearances`,
        source: "characterAccountAppearances",
        expected_total_count: account?.appearance_count ?? null,
        character_display_name: account?.display_name || profileMatch?.display_name || account?.username || profileMatch?.username || "",
        character_id: characterId
      }, fetchWindow));
      jobs.push(withFetchWindow({
        id: `character-account-drafts:${characterId}`,
        label: `${labelPrefix} drafts`,
        source: "characterAccountDrafts",
        expected_total_count: account?.draft_count ?? null,
        character_display_name: account?.display_name || profileMatch?.display_name || account?.username || profileMatch?.username || "",
        character_id: characterId
      }, fetchWindow));
    }
  }
  if (selectedSources.creators) {
    for (const profile of state.creator_profiles) {
      jobs.push(...buildCreatorJobs(profile, state.character_accounts, fetchWindow));
    }
  }

  return dedupeFetchJobs(jobs);
}

function buildCreatorJobs(
  profile: CreatorProfile,
  characterAccounts: AppStoreState["character_accounts"],
  fetchWindow: { sinceMs: number | null; untilMs: number | null }
): FetchJob[] {
  const baseJobData = {
    creator_user_id: profile.owner_user_id || profile.user_id,
    creator_username: profile.username,
    route_url: profile.permalink
  };

  if (profile.is_character_profile) {
    const permalinkName = resolvePermalinkProfileName(profile.permalink);
    const matchedAccount = characterAccounts.find(
      (account) =>
        account.account_id === profile.character_user_id ||
        account.account_id === profile.user_id ||
        account.account_id === profile.profile_id ||
        (profile.username && account.username === profile.username)
    );
    const resolvedCharacterId = resolveCharacterId(profile, matchedAccount?.account_id, permalinkName);
    if (!resolvedCharacterId) {
      return [];
    }

    const resolvedCharacterDisplayName =
      matchedAccount?.display_name ||
      profile.display_name ||
      matchedAccount?.username ||
      profile.username ||
      permalinkName ||
      resolvedCharacterId ||
      "Character";

    return [
      withFetchWindow({
        id: `creator-character-appearances:${profile.profile_id}`,
        label: `${resolvedCharacterDisplayName} appearances`,
        source: "characterAccountAppearances",
        expected_total_count: profile.appearance_count,
        character_display_name: resolvedCharacterDisplayName,
        character_id: resolvedCharacterId,
        route_url: profile.permalink
      }, fetchWindow),
      withFetchWindow({
        id: `creator-character-drafts:${profile.profile_id}`,
        label: `${resolvedCharacterDisplayName} drafts`,
        source: "characterAccountDrafts",
        expected_total_count: profile.draft_count,
        character_display_name: resolvedCharacterDisplayName,
        character_id: resolvedCharacterId,
        route_url: profile.permalink
      }, fetchWindow)
    ];
  }

  return [
    withFetchWindow({
      id: `creator-published:${profile.profile_id}`,
      label: `${profile.display_name} published`,
      source: "creatorPublished",
      expected_total_count: profile.published_count,
      ...baseJobData
    }, fetchWindow),
    withFetchWindow({
      id: `creator-cameos:${profile.profile_id}`,
      label: `${profile.display_name} cameos`,
      source: "creatorCameos",
      expected_total_count: profile.appearance_count,
      ...baseJobData
    }, fetchWindow)
  ];
}

function resolveCharacterId(profile: CreatorProfile, accountId: string | undefined, permalinkName: string): string {
  const preferred = [profile.character_user_id, profile.user_id, profile.profile_id, accountId, permalinkName].find(
    (value) => Boolean(value && value.startsWith("ch_"))
  );
  return preferred || "";
}

function resolvePermalinkProfileName(permalink: string | null): string {
  if (!permalink) {
    return "";
  }

  const trimmed = permalink.trim();
  if (!trimmed) {
    return "";
  }

  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }

  const lastSegment = segments[segments.length - 1] ?? "";
  return decodeURIComponent(lastSegment).trim();
}

function dedupeFetchJobs(jobs: FetchJob[]): FetchJob[] {
  const jobMap = new Map<string, FetchJob>();

  for (const job of jobs) {
    const signature = buildFetchJobSignature(job);
    const existingJob = jobMap.get(signature);

    if (!existingJob) {
      jobMap.set(signature, job);
      continue;
    }

    jobMap.set(signature, {
      ...existingJob,
      expected_total_count: pickHigherCount(existingJob.expected_total_count, job.expected_total_count)
    });
  }

  return [...jobMap.values()];
}

function buildFetchJobSignature(job: FetchJob): string {
  if (job.source === "characterAccountAppearances" || job.source === "characterAccountDrafts") {
    return [job.source, job.character_id ?? ""].join("|");
  }

  return [
    job.source,
    job.creator_user_id ?? "",
    job.creator_username ?? "",
    job.route_url ?? ""
  ].join("|");
}

function pickHigherCount(left: number | null, right: number | null): number | null {
  if (typeof left !== "number") {
    return right;
  }
  if (typeof right !== "number") {
    return left;
  }
  return Math.max(left, right);
}

function resolveCharacterLabel(
  accountDisplayName: string | undefined,
  accountUsername: string | undefined,
  profileDisplayName: string | undefined,
  profileUsername: string | undefined,
  characterId: string
): string {
  return (
    accountDisplayName?.trim() ||
    profileDisplayName?.trim() ||
    accountUsername?.trim() ||
    profileUsername?.trim() ||
    (characterId.startsWith("ch_") ? "Character" : characterId)
  );
}

function withFetchWindow(job: FetchJob, fetchWindow: { sinceMs: number | null; untilMs: number | null }): FetchJob {
  return {
    ...job,
    fetch_since_ms: fetchWindow.sinceMs,
    fetch_until_ms: fetchWindow.untilMs
  };
}

function resolveFetchWindowMs(state: AppStoreState): { sinceMs: number | null; untilMs: number | null } {
  const preset = state.session_meta.date_range_preset;
  const now = Date.now();

  if (preset === "24h") {
    return { sinceMs: now - 24 * 60 * 60 * 1000, untilMs: now };
  }
  if (preset === "7d") {
    return { sinceMs: now - 7 * 24 * 60 * 60 * 1000, untilMs: now };
  }
  if (preset === "1m") {
    return { sinceMs: now - 30 * 24 * 60 * 60 * 1000, untilMs: now };
  }
  if (preset === "3m") {
    return { sinceMs: now - 90 * 24 * 60 * 60 * 1000, untilMs: now };
  }
  if (preset !== "custom") {
    return { sinceMs: null, untilMs: null };
  }

  return {
    sinceMs: parseDateStartMs(state.session_meta.custom_date_start),
    untilMs: parseDateEndMs(state.session_meta.custom_date_end)
  };
}

function parseDateStartMs(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateEndMs(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(parsed) ? parsed : null;
}
