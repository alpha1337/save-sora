// Classic-script bridge for the shared source-selection helpers.
// background.js loads this with importScripts() so the helpers are available
// synchronously in the service worker without changing the extension's module
// loading model.
(function () {
  if (
    globalThis.__SAVE_SORA_SOURCE_SELECTION__ &&
    typeof globalThis.__SAVE_SORA_SOURCE_SELECTION__ === "object"
  ) {
    return;
  }

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

  function isCanonicalCreatorUserId(value) {
    return typeof value === "string" && /^user-[A-Za-z0-9_-]+$/.test(value);
  }

  function isCharacterAccountUserId(value) {
    return typeof value === "string" && /^ch_[A-Za-z0-9_-]+$/.test(value);
  }

  function normalizeCharacterAccounts(value) {
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

  function normalizeCreatorUsername(value) {
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

  function getCreatorUsernameFromPathname(value) {
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

  function getCreatorUsernameFromUrl(value) {
    if (typeof value !== "string" || !value) {
      return "";
    }

    try {
      return getCreatorUsernameFromPathname(new URL(value, "https://sora.chatgpt.com").pathname);
    } catch (_error) {
      return getCreatorUsernameFromPathname(value);
    }
  }

  function isGenericCreatorDisplayName(value) {
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

  function normalizeCreatorDisplayName(value, fallbackUsername = "") {
    if (typeof value === "string" && value.trim() && !isGenericCreatorDisplayName(value)) {
      return value.trim().replace(/\s+/g, " ");
    }

    return normalizeCreatorUsername(fallbackUsername);
  }

  globalThis.__SAVE_SORA_SOURCE_SELECTION__ = {
    isCanonicalCreatorUserId,
    isCharacterAccountUserId,
    normalizeCharacterAccounts,
    normalizeCreatorUsername,
    getCreatorUsernameFromPathname,
    getCreatorUsernameFromUrl,
    isGenericCreatorDisplayName,
    normalizeCreatorDisplayName,
  };
})();
