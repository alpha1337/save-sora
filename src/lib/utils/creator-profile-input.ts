const SORA_PROFILE_ORIGIN = "https://sora.chatgpt.com";

/**
 * Normalizes user-entered creator input into a canonical Sora profile URL.
 * Accepts bare handles, `@handle`, profile paths, and full profile URLs.
 */
export function normalizeCreatorProfileInput(input: string): string {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw new Error("Paste a valid Sora creator username or profile link.");
  }

  const directHandle = normalizeCreatorHandle(trimmedInput);
  if (directHandle && !/[/:]/.test(trimmedInput.replace(/^@+/, ""))) {
    return buildCanonicalProfileUrl(directHandle);
  }

  const pathHandle = getHandleFromPath(trimmedInput);
  if (pathHandle && !/^https?:\/\//i.test(trimmedInput)) {
    return buildCanonicalProfileUrl(pathHandle);
  }

  let normalizedUrl: URL;
  try {
    normalizedUrl = new URL(
      /^sora\.chatgpt\.com(?:\/|$)/i.test(trimmedInput) ? `https://${trimmedInput}` : trimmedInput
    );
  } catch (_error) {
    throw new Error("Paste a valid Sora creator username or profile link.");
  }

  if (normalizedUrl.hostname !== "sora.chatgpt.com") {
    throw new Error("Paste a Sora creator username or a sora.chatgpt.com profile link.");
  }

  const normalizedHandle = getHandleFromPath(normalizedUrl.pathname);
  if (!normalizedHandle) {
    throw new Error("Paste a valid Sora creator username or profile link.");
  }

  return buildCanonicalProfileUrl(normalizedHandle);
}

function buildCanonicalProfileUrl(handle: string): string {
  return `${SORA_PROFILE_ORIGIN}/profile/${encodeURIComponent(handle)}`;
}

function getHandleFromPath(value: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return "";
  }

  const pathname = normalizedValue.startsWith("/")
    ? normalizedValue
    : (() => {
        try {
          return new URL(normalizedValue, SORA_PROFILE_ORIGIN).pathname;
        } catch (_error) {
          return normalizedValue;
        }
      })();
  const segments = pathname.split("/").filter(Boolean);
  const profileSegment =
    segments.find((segment) => segment.startsWith("@")) ??
    (segments[0] === "profile" ? segments[1] : segments[0]);

  return normalizeCreatorHandle(profileSegment ?? "");
}

function normalizeCreatorHandle(value: string): string {
  const normalizedValue = value.trim().replace(/^@+/, "").replace(/\/+$/g, "");
  return /^[A-Za-z0-9._-]+$/.test(normalizedValue) ? normalizedValue : "";
}
