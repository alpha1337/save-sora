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
  const viewerScopeKey = resolveViewerScopeKey(state);

  if (selectedSources.profile) {
    jobs.push(withFetchWindow({
      id: `profile:${viewerScopeKey}`,
      label: "Published posts",
      source: "profile",
      expected_total_count: null
    }, fetchWindow));
  }
  if (selectedSources.drafts) {
    jobs.push(withFetchWindow({
      id: `drafts:${viewerScopeKey}`,
      label: "Drafts",
      source: "drafts",
      expected_total_count: null
    }, fetchWindow));
  }
  if (selectedSources.likes) {
    jobs.push(withFetchWindow({
      id: `likes:${viewerScopeKey}`,
      label: "Liked posts",
      source: "likes",
      expected_total_count: null
    }, fetchWindow));
  }
  if (selectedSources.characters) {
    jobs.push(withFetchWindow({
      id: `characters-cameos:${viewerScopeKey}`,
      label: "Cameos",
      source: "characters",
      expected_total_count: null
    }, fetchWindow));
  }
  if (selectedSources.characterAccounts) {
    jobs.push(...buildCharacterAccountJobs(state, state.session_meta.selected_character_account_ids, fetchWindow));
  }
  if (selectedSources.creators) {
    for (const profile of state.creator_profiles) {
      jobs.push(...buildCreatorJobs(profile, fetchWindow, state.session_meta.viewer_user_id ?? ""));
    }
  }

  return dedupeFetchJobs(jobs);
}

function buildCharacterAccountJobs(
  state: AppStoreState,
  characterIds: string[],
  fetchWindow: { sinceMs: number | null; untilMs: number | null }
): FetchJob[] {
  const jobs: FetchJob[] = [];
  const uniqueCharacterIds = [...new Set(characterIds.map((value) => value.trim()).filter(Boolean))];

  for (const characterId of uniqueCharacterIds) {
    if (!characterId.startsWith("ch_")) {
      continue;
    }
    const account = state.character_accounts.find((entry) => entry.account_id === characterId);
    const profileMatch = state.creator_profiles.find(
      (profile) =>
        profile.is_character_profile &&
        (profile.character_user_id === characterId || profile.user_id === characterId || profile.profile_id === characterId)
    );
    const labelPrefix = resolveCharacterLabel(
      account?.display_name,
      account?.username,
      profileMatch?.display_name,
      profileMatch?.username,
      characterId
    );
    const characterDisplayName = account?.display_name || profileMatch?.display_name || account?.username || profileMatch?.username || "";

    jobs.push(withFetchWindow({
      id: `character-account-appearances:${characterId}`,
      label: `${labelPrefix} appearances`,
      source: "characterAccountAppearances",
      expected_total_count: account?.appearance_count ?? null,
      character_display_name: characterDisplayName,
      character_id: characterId
    }, fetchWindow));
    jobs.push(withFetchWindow({
      id: `character-account-drafts:${characterId}`,
      label: `${labelPrefix} drafts`,
      source: "characterAccountDrafts",
      expected_total_count: account?.draft_count ?? null,
      character_display_name: characterDisplayName,
      character_id: characterId
    }, fetchWindow));
  }

  return jobs;
}

function buildCreatorJobs(
  profile: CreatorProfile,
  fetchWindow: { sinceMs: number | null; untilMs: number | null },
  viewerUserId: string
): FetchJob[] {
  const creatorLabel = profile.display_name?.trim() || profile.username?.trim() || profile.profile_id || "Creator";
  const candidateCharacterIds = [profile.character_user_id, profile.profile_id, profile.user_id]
    .map((value) => (value || "").trim())
    .filter((value) => value.length > 0);
  const preferredCharacterId = candidateCharacterIds.find((value) => value.startsWith("ch_")) || "";
  const hasPublishedPosts = typeof profile.published_count === "number" && profile.published_count > 0;
  const hasExplicitSideCharacterType = profile.account_type === "sideCharacter";
  const hasExplicitCreatorType = profile.account_type === "creator";
  const shouldTreatAsCharacterProfile =
    hasExplicitSideCharacterType ||
    profile.is_character_profile ||
    preferredCharacterId.startsWith("ch_") ||
    (!hasExplicitCreatorType && (
      (!hasPublishedPosts && (preferredCharacterId.startsWith("ch_") || isLikelyCharacterProfile(profile)))
    ));
  if (shouldTreatAsCharacterProfile) {
    if (!isSideCharacterProfile(profile, viewerUserId)) {
      return [];
    }
    return [
      withFetchWindow({
        id: `side-character-appearances:${profile.profile_id}`,
        label: `${creatorLabel} appearances`,
        source: "sideCharacter",
        expected_total_count: profile.appearance_count,
        character_display_name: creatorLabel,
        character_id: preferredCharacterId || undefined,
        creator_username: profile.username,
        route_url: profile.permalink
      }, fetchWindow)
    ];
  }

  const resolvedCreatorUserId = resolveCreatorUserId(profile);
  const baseJobData = {
    creator_user_id: resolvedCreatorUserId || undefined,
    creator_username: profile.username,
    route_url: profile.permalink
  };

  return [
    withFetchWindow({
      id: `creator-published:${profile.profile_id}`,
      label: `${creatorLabel} published`,
      source: "creatorPublished",
      expected_total_count: profile.published_count,
      ...baseJobData
    }, fetchWindow)
  ];
}

function isSideCharacterProfile(profile: CreatorProfile, viewerUserId: string): boolean {
  const normalizedViewerUserId = viewerUserId.trim();
  if (!normalizedViewerUserId) {
    return true;
  }

  const ownerUserId = (profile.owner_user_id || "").trim();
  if (ownerUserId) {
    return ownerUserId !== normalizedViewerUserId;
  }

  const profileUserId = (profile.user_id || "").trim();
  if (isUserAccountId(profileUserId)) {
    return profileUserId !== normalizedViewerUserId;
  }

  return true;
}

function isLikelyCharacterProfile(profile: CreatorProfile): boolean {
  const profileId = (profile.profile_id || "").trim();
  const userId = (profile.user_id || "").trim();
  const characterUserId = (profile.character_user_id || "").trim();

  if (profileId.startsWith("ch_") || userId.startsWith("ch_") || characterUserId.startsWith("ch_")) {
    return true;
  }

  if (profile.published_count === 0 && typeof profile.appearance_count === "number" && profile.appearance_count > 0) {
    return true;
  }

  return false;
}

function resolveCreatorUserId(profile: CreatorProfile): string {
  const ownerUserId = (profile.owner_user_id || "").trim();
  if (isUserAccountId(ownerUserId)) {
    return ownerUserId;
  }

  const profileUserId = (profile.user_id || "").trim();
  if (isUserAccountId(profileUserId)) {
    return profileUserId;
  }

  return "";
}

function isUserAccountId(value: string): boolean {
  return value.startsWith("user_") || value.startsWith("user-");
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
  if (job.source === "sideCharacter") {
    return [
      job.source,
      job.character_id ?? "",
      job.creator_username ?? "",
      job.route_url ?? ""
    ].join("|");
  }

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

function resolveViewerScopeKey(state: AppStoreState): string {
  const candidate = (state.session_meta.viewer_user_id || state.session_meta.viewer_username || "anonymous")
    .trim()
    .toLowerCase();
  return candidate
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "anonymous";
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
  const date = parseLocalDateInput(value);
  if (!date) {
    return null;
  }
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
}

function parseDateEndMs(value: string): number | null {
  const date = parseLocalDateInput(value);
  if (!date) {
    return null;
  }
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
}

function parseLocalDateInput(value: string): Date | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const match = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const localDate = new Date(year, month - 1, day);
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day
  ) {
    return null;
  }

  return localDate;
}
