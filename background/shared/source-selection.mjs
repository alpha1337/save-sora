/**
 * Source selection normalization helpers.
 *
 * This module owns the creator and side-character identity contract used by
 * restore, selection, and fetch orchestration. It does not own runtime state,
 * storage, or fetch side effects.
 */

/**
 * Returns unique non-empty string IDs in insertion order.
 *
 * @param {unknown} values Candidate values.
 * @returns {string[]} Deduplicated string IDs.
 */
function normalizeUniqueStringIds(values) {
  const normalizedValues = [];

  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value || normalizedValues.includes(value)) {
      continue;
    }
    normalizedValues.push(value);
  }

  return normalizedValues;
}

/**
 * Reconciles a requested selection against the currently known IDs.
 *
 * @param {string[]} validIds IDs that are currently known in memory.
 * @param {unknown} requestedIds IDs requested by the caller.
 * @param {unknown} [fallbackIds=null] Fallback IDs to use when no explicit request survives.
 * @param {{allowEmpty?: boolean, preserveUnknownRequestedIds?: boolean}} [options={}] Selection rules.
 * @returns {string[]} Normalized selected IDs.
 */
function normalizeSelectedIds(validIds, requestedIds, fallbackIds = null, options = {}) {
  const normalizedValidIds = normalizeUniqueStringIds(validIds);
  const validIdSet = new Set(normalizedValidIds);
  const normalizedRequestedIds = normalizeUniqueStringIds(requestedIds);
  const allowEmpty = options && options.allowEmpty === true;
  const preserveUnknownRequestedIds =
    options && options.preserveUnknownRequestedIds === true;

  const selectedIds = normalizedRequestedIds.filter((value) => validIdSet.has(value));
  const preservedUnknownIds = preserveUnknownRequestedIds
    ? normalizedRequestedIds.filter((value) => !validIdSet.has(value))
    : [];

  if (selectedIds.length > 0 || preservedUnknownIds.length > 0) {
    return [...selectedIds, ...preservedUnknownIds];
  }

  if (allowEmpty && Array.isArray(requestedIds)) {
    return [];
  }

  if (Array.isArray(fallbackIds) && fallbackIds.length) {
    return normalizeSelectedIds(normalizedValidIds, fallbackIds, [], {
      ...options,
      preserveUnknownRequestedIds,
    });
  }

  return [...normalizedValidIds];
}

/**
 * Returns whether a value is a canonical creator user ID.
 *
 * @param {unknown} value Candidate ID.
 * @returns {boolean} True when the value is a canonical creator user ID.
 */
export function isCanonicalCreatorUserId(value) {
  return typeof value === "string" && /^user-[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Returns whether a value is a side-character account ID.
 *
 * @param {unknown} value Candidate ID.
 * @returns {boolean} True when the value is a side-character account ID.
 */
export function isCharacterAccountUserId(value) {
  return typeof value === "string" && /^ch_[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Keeps only well-formed side-character account records.
 *
 * @param {unknown} value Candidate account records.
 * @returns {Array<object>} Normalized account records.
 */
export function normalizeCharacterAccounts(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (account) =>
        account &&
        typeof account.userId === "string" &&
        account.userId &&
        account.userId.startsWith("ch_"),
    )
    .map((account) => ({
      userId: account.userId,
      username: typeof account.username === "string" ? account.username : "",
      displayName:
        typeof account.displayName === "string" && account.displayName
          ? account.displayName
          : typeof account.username === "string" && account.username
            ? account.username
            : account.userId,
      postCount: Number.isFinite(Number(account.postCount)) ? Number(account.postCount) : 0,
      cameoCount: Number.isFinite(Number(account.cameoCount)) ? Number(account.cameoCount) : 0,
      permalink: typeof account.permalink === "string" ? account.permalink : null,
      profilePictureUrl:
        typeof account.profilePictureUrl === "string" ? account.profilePictureUrl : null,
    }));
}

/**
 * Decodes a creator URL segment without throwing for malformed input.
 *
 * @param {unknown} value Candidate URL segment.
 * @returns {string} Decoded segment.
 */
function decodeCreatorUrlSegment(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

/**
 * Normalizes a creator username or profile segment.
 *
 * @param {unknown} value Candidate username.
 * @returns {string} Normalized username.
 */
export function normalizeCreatorUsername(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = decodeCreatorUrlSegment(value)
    .trim()
    .replace(/^@+/, "")
    .replace(/\/+$/, "");

  if (!cleaned) {
    return "";
  }

  const reservedSegments = new Set(["profile", "profiles", "drafts", "characters", "likes"]);
  return reservedSegments.has(cleaned.toLowerCase()) ? "" : cleaned;
}

/**
 * Extracts a creator username from a Sora pathname.
 *
 * @param {unknown} value Candidate pathname.
 * @returns {string} Extracted username, or an empty string when none is present.
 */
export function getCreatorUsernameFromPathname(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const segments = value
    .split("/")
    .map((segment) => normalizeCreatorUsername(segment))
    .filter(Boolean);

  if (!segments.length) {
    return "";
  }

  if (value.includes("/@")) {
    const atSegment = value
      .split("/")
      .find((segment) => typeof segment === "string" && segment.trim().startsWith("@"));
    return normalizeCreatorUsername(atSegment || "");
  }

  if (segments[0].toLowerCase() === "profile") {
    return normalizeCreatorUsername(segments[1] || "");
  }

  return normalizeCreatorUsername(segments[0]);
}

/**
 * Extracts a creator username from a creator URL or path.
 *
 * @param {unknown} value Candidate URL or path.
 * @returns {string} Extracted username.
 */
export function getCreatorUsernameFromUrl(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  try {
    return getCreatorUsernameFromPathname(new URL(value, "https://sora.chatgpt.com").pathname);
  } catch (_error) {
    return getCreatorUsernameFromPathname(value);
  }
}

/**
 * Returns whether a creator display name looks like a placeholder or generic site label.
 *
 * @param {unknown} value Candidate display name.
 * @returns {boolean} True when the name looks generic.
 */
export function isGenericCreatorDisplayName(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized === "sora" ||
    normalized === "chatgpt" ||
    normalized === "openai" ||
    /^sora\s*[-|:]/.test(normalized) ||
    /^chatgpt\s*[-|:]/.test(normalized) ||
    /^openai\s*[-|:]/.test(normalized) ||
    normalized.includes("guardrails around content") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

/**
 * Normalizes a creator display name while avoiding generic placeholders.
 *
 * @param {unknown} value Candidate display name.
 * @param {string} [fallbackUsername=""] Username fallback used when the display name is generic.
 * @returns {string} Normalized display name.
 */
export function normalizeCreatorDisplayName(value, fallbackUsername = "") {
  if (typeof value === "string" && value.trim() && !isGenericCreatorDisplayName(value)) {
    return value.trim().replace(/\s+/g, " ");
  }

  return normalizeCreatorUsername(fallbackUsername);
}

/**
 * Returns the default creator fetch preferences.
 *
 * @returns {{includeOfficialPosts: boolean, includeCommunityPosts: boolean}} Default fetch preferences.
 */
export function getDefaultCreatorFetchPreferences() {
  return {
    includeOfficialPosts: true,
    includeCommunityPosts: true,
  };
}

/**
 * Normalizes creator fetch preferences.
 *
 * @param {unknown} profile Candidate profile record.
 * @returns {{includeOfficialPosts: boolean, includeCommunityPosts: boolean}} Normalized preferences.
 */
export function normalizeCreatorFetchPreferences(profile) {
  const defaults = getDefaultCreatorFetchPreferences();
  const sourceProfile = profile && typeof profile === "object" ? profile : {};
  const hasCustomFetchPreferences = sourceProfile.hasCustomFetchPreferences === true;
  const hasExplicitOfficialPreference = typeof sourceProfile.includeOfficialPosts === "boolean";
  const hasExplicitCommunityPreference = typeof sourceProfile.includeCommunityPosts === "boolean";

  if (
    !hasCustomFetchPreferences &&
    hasExplicitOfficialPreference &&
    hasExplicitCommunityPreference &&
    ((sourceProfile.includeOfficialPosts === true &&
      sourceProfile.includeCommunityPosts === false) ||
      (sourceProfile.includeOfficialPosts === false &&
        sourceProfile.includeCommunityPosts === true))
  ) {
    return { ...defaults };
  }

  return {
    includeOfficialPosts: hasExplicitOfficialPreference
      ? sourceProfile.includeOfficialPosts
      : defaults.includeOfficialPosts,
    includeCommunityPosts: hasExplicitCommunityPreference
      ? sourceProfile.includeCommunityPosts
      : defaults.includeCommunityPosts,
  };
}

/**
 * Keeps saved creator profiles in a durable, non-destructive shape.
 *
 * @param {unknown} value Candidate creator profile records.
 * @returns {Array<object>} Normalized creator profiles.
 */
export function normalizeCreatorProfiles(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (profile) =>
        profile &&
        typeof profile.profileId === "string" &&
        profile.profileId,
    )
    .map((profile) => {
      const profileId = profile.profileId;
      const userId = typeof profile.userId === "string" ? profile.userId : "";
      const profileData =
        profile.profileData && typeof profile.profileData === "object"
          ? profile.profileData
          : null;
      const ownerUserId =
        typeof profile.ownerUserId === "string" && profile.ownerUserId
          ? profile.ownerUserId
          : userId;
      const characterUserId =
        typeof profile.characterUserId === "string" && isCharacterAccountUserId(profile.characterUserId)
          ? profile.characterUserId
          : "";
      const ownerUsername =
        typeof profile.ownerUsername === "string" ? normalizeCreatorUsername(profile.ownerUsername) : "";
      const permalink =
        typeof profile.permalink === "string" && profile.permalink ? profile.permalink : null;
      const username =
        normalizeCreatorUsername(profile.username) ||
        getCreatorUsernameFromUrl(permalink) ||
        (/[/:@]/.test(profileId) ? getCreatorUsernameFromUrl(profileId) : "");
      const displayName =
        normalizeCreatorDisplayName(
          profileData && typeof profileData.display_name === "string" ? profileData.display_name : profile.displayName,
          username,
        ) ||
        username ||
        userId ||
        profileId;
      const fetchPreferences = normalizeCreatorFetchPreferences(profile);

      return {
        profileId,
        userId,
        username,
        displayName,
        permalink,
        profilePictureUrl:
          typeof profile.profilePictureUrl === "string" ? profile.profilePictureUrl : null,
        ownerUserId,
        ownerUsername: ownerUsername || "",
        characterUserId,
        profileFetchedAt:
          typeof profile.profileFetchedAt === "string" && profile.profileFetchedAt
            ? profile.profileFetchedAt
            : null,
        profileData,
        hasCustomFetchPreferences: profile.hasCustomFetchPreferences === true,
        includeOfficialPosts: fetchPreferences.includeOfficialPosts,
        includeCommunityPosts: fetchPreferences.includeCommunityPosts,
      };
    });
}

/**
 * Normalizes saved side-character selections.
 *
 * @param {unknown} characterAccounts Current side-character inventory.
 * @param {unknown} requestedIds Requested selected IDs.
 * @param {unknown} [fallbackIds=null] Fallback selected IDs.
 * @param {{allowEmpty?: boolean, preserveUnknownRequestedIds?: boolean}} [options={}] Selection rules.
 * @returns {string[]} Normalized selected side-character IDs.
 */
export function normalizeSelectedCharacterAccountIds(
  characterAccounts,
  requestedIds,
  fallbackIds = null,
  options = {},
) {
  const validIds = normalizeCharacterAccounts(characterAccounts).map((account) => account.userId);
  return normalizeSelectedIds(validIds, requestedIds, fallbackIds, options);
}

/**
 * Normalizes saved creator selections.
 *
 * @param {unknown} creatorProfiles Current creator inventory.
 * @param {unknown} requestedIds Requested selected IDs.
 * @param {unknown} [fallbackIds=null] Fallback selected IDs.
 * @param {{allowEmpty?: boolean, preserveUnknownRequestedIds?: boolean}} [options={}] Selection rules.
 * @returns {string[]} Normalized selected creator profile IDs.
 */
export function normalizeSelectedCreatorProfileIds(
  creatorProfiles,
  requestedIds,
  fallbackIds = null,
  options = {},
) {
  const validIds = normalizeCreatorProfiles(creatorProfiles).map((profile) => profile.profileId);
  return normalizeSelectedIds(validIds, requestedIds, fallbackIds, options);
}

/**
 * Resolves the side-character account ID represented by a creator profile.
 *
 * @param {unknown} profile Candidate creator profile.
 * @returns {string} Side-character account ID, or an empty string when the profile is a normal creator.
 */
export function getCreatorProfileCharacterUserId(profile) {
  if (!profile || typeof profile !== "object") {
    return "";
  }

  if (isCharacterAccountUserId(profile.profileId)) {
    return profile.profileId;
  }

  if (isCharacterAccountUserId(profile.userId)) {
    return profile.userId;
  }

  if (isCharacterAccountUserId(profile.characterUserId)) {
    const hasCanonicalCreatorIdentity =
      isCanonicalCreatorUserId(profile.userId) ||
      isCanonicalCreatorUserId(profile.ownerUserId);
    const hasExplicitCreatorProfileId =
      typeof profile.profileId === "string" &&
      profile.profileId &&
      !isCharacterAccountUserId(profile.profileId);

    if (!hasCanonicalCreatorIdentity || !hasExplicitCreatorProfileId) {
      return profile.characterUserId;
    }
  }

  return "";
}
