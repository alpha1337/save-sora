/**
 * In-page auth helpers for Sora API requests executed from the signed-in hidden
 * tab so requests inherit the user's browser session.
 */
export interface AuthContext {
  deviceId: string;
  language: string;
  token: string;
}

const AUTH_CACHE_TTL_MS = 60_000;

let cachedAuthContext: AuthContext | null = null;
let cachedAuthContextAt = 0;
let cachedViewerUserId = "";

export async function deriveAuthContext(): Promise<AuthContext> {
  if (cachedAuthContext && Date.now() - cachedAuthContextAt < AUTH_CACHE_TTL_MS) {
    return cachedAuthContext;
  }

  const deviceId = getCookieValue("oai-did");
  const language = navigator.language || "en-US";
  const sessionToken = (await trySessionEndpoint("/api/auth/session")) || (await trySessionEndpoint("/auth/session"));
  const storageToken =
    sessionToken ||
    findTokenInWebStorage(window.sessionStorage) ||
    findTokenInWebStorage(window.localStorage) ||
    findTokenInObject((window as Window & typeof globalThis & { __NEXT_DATA__?: unknown }).__NEXT_DATA__);

  if (!storageToken) {
    throw new Error("Could not derive a Sora bearer token from the signed-in browser session.");
  }

  cachedAuthContext = { token: storageToken, deviceId, language };
  cachedAuthContextAt = Date.now();

  return cachedAuthContext;
}

export async function deriveViewerUserId(): Promise<string> {
  if (cachedViewerUserId) {
    return cachedViewerUserId;
  }

  const authContext = await deriveAuthContext();
  const tokenPayload = decodeJwtPayload(authContext.token);
  const authClaims = tokenPayload?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  const tokenUserId = pickFirstString([
    authClaims?.user_id,
    authClaims?.chatgpt_user_id,
    tokenPayload?.user_id,
    tokenPayload?.chatgpt_user_id
  ]);

  if (typeof tokenUserId === "string" && /^user-[A-Za-z0-9_-]+$/.test(tokenUserId)) {
    cachedViewerUserId = tokenUserId;
    return cachedViewerUserId;
  }

  const nextDataUserId = findViewerUserIdFromPayload((window as Window & typeof globalThis & { __NEXT_DATA__?: unknown }).__NEXT_DATA__);
  if (nextDataUserId) {
    cachedViewerUserId = nextDataUserId;
    return cachedViewerUserId;
  }

  throw new Error("Could not derive the signed-in Sora viewer id.");
}

function getCookieValue(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function trySessionEndpoint(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" }
    });
    if (!response.ok) {
      return "";
    }
    return findTokenInObject(await response.json());
  } catch (_error) {
    return "";
  }
}

function findTokenInWebStorage(storage: Storage): string {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }
    const value = storage.getItem(key);
    if (!value) {
      continue;
    }

    const directMatch = extractBearerToken(value);
    if (directMatch) {
      return directMatch;
    }

    try {
      const parsedValue = JSON.parse(value) as unknown;
      const objectMatch = findTokenInObject(parsedValue);
      if (objectMatch) {
        return objectMatch;
      }
    } catch (_error) {
      continue;
    }
  }

  return "";
}

function findTokenInObject(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return extractBearerToken(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findTokenInObject(entry, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directToken = pickFirstString([
    record.accessToken,
    record.access_token,
    record.token,
    record.idToken,
    record.id_token
  ]);
  if (directToken) {
    return extractBearerToken(directToken);
  }

  for (const entryValue of Object.values(record)) {
    const match = findTokenInObject(entryValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return "";
}

function extractBearerToken(value: string): string {
  const trimmedValue = value.trim();
  if (/^eyJ[A-Za-z0-9._-]+$/.test(trimmedValue)) {
    return trimmedValue;
  }

  const bearerMatch = trimmedValue.match(/eyJ[A-Za-z0-9._-]+/);
  return bearerMatch?.[0] ?? "";
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

function findViewerUserIdFromPayload(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findViewerUserIdFromPayload(entry, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const userId = pickFirstString([record.user_id, record.userId, record.chatgpt_user_id, record.chatgptUserId]);
  if (userId && /^user-[A-Za-z0-9_-]+$/.test(userId)) {
    return userId;
  }

  for (const entryValue of Object.values(record)) {
    const match = findViewerUserIdFromPayload(entryValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return "";
}

function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}
