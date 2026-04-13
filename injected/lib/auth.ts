/**
 * In-page auth helpers for Sora API requests executed from the signed-in hidden
 * tab so requests inherit the user's browser session.
 */
import { CHATGPT_ORIGIN, SORA_ORIGIN } from "./origins";

export interface AuthContext {
  deviceId: string;
  language: string;
  token: string;
}

interface SessionSnapshot {
  token: string;
  userId: string;
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
  const bootstrapSnapshot = readBootstrapSnapshot();
  const sessionSnapshot =
    bootstrapSnapshot ||
    (await trySessionEndpoint(`${SORA_ORIGIN}/api/auth/session`)) ||
    (await trySessionEndpoint(`${SORA_ORIGIN}/auth/session`)) ||
    (await trySessionEndpoint("/api/auth/session")) ||
    (await trySessionEndpoint("/auth/session")) ||
    (await trySessionEndpoint(`${CHATGPT_ORIGIN}/api/auth/session`)) ||
    (await trySessionEndpoint(`${CHATGPT_ORIGIN}/auth/session`));
  const token =
    pickFirstString([
      window.sessionStorage.getItem("save_sora_auth_token"),
      window.localStorage.getItem("save_sora_auth_token"),
      bootstrapSnapshot?.token,
      sessionSnapshot?.token
    ]) ||
    findTokenInWebStorage(window.sessionStorage) ||
    findTokenInWebStorage(window.localStorage) ||
    findTokenInObject((window as Window & typeof globalThis & { __NEXT_DATA__?: unknown }).__NEXT_DATA__);

  if (!token) {
    throw new Error("Could not derive a Sora bearer token from the signed-in browser session.");
  }

  if (sessionSnapshot?.userId) {
    cachedViewerUserId = sessionSnapshot.userId;
  }

  cachedAuthContext = { token, deviceId, language };
  cachedAuthContextAt = Date.now();

  return cachedAuthContext;
}

export async function deriveViewerUserId(): Promise<string> {
  if (cachedViewerUserId) {
    return cachedViewerUserId;
  }

  const bootstrapSnapshot = readBootstrapSnapshot();
  const seededViewerUserId = pickFirstString([
    window.localStorage.getItem("save_sora_viewer_user_id"),
    window.sessionStorage.getItem("save_sora_viewer_user_id"),
    bootstrapSnapshot?.userId
  ]);
  if (seededViewerUserId) {
    cachedViewerUserId = seededViewerUserId;
    return cachedViewerUserId;
  }

  const sessionSnapshot =
    bootstrapSnapshot ||
    (await trySessionEndpoint(`${SORA_ORIGIN}/api/auth/session`)) ||
    (await trySessionEndpoint(`${SORA_ORIGIN}/auth/session`)) ||
    (await trySessionEndpoint("/api/auth/session")) ||
    (await trySessionEndpoint("/auth/session")) ||
    (await trySessionEndpoint(`${CHATGPT_ORIGIN}/api/auth/session`)) ||
    (await trySessionEndpoint(`${CHATGPT_ORIGIN}/auth/session`));
  if (sessionSnapshot?.userId) {
    cachedViewerUserId = sessionSnapshot.userId;
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

function readBootstrapSnapshot(): SessionSnapshot | null {
  const bootstrapJson = pickFirstString([
    window.sessionStorage.getItem("save_sora_auth_bootstrap"),
    window.localStorage.getItem("save_sora_auth_bootstrap")
  ]);
  const seededToken = pickFirstString([
    window.sessionStorage.getItem("save_sora_auth_token"),
    window.localStorage.getItem("save_sora_auth_token")
  ]);
  const seededUserId = pickFirstString([
    window.sessionStorage.getItem("save_sora_viewer_user_id"),
    window.localStorage.getItem("save_sora_viewer_user_id")
  ]);

  let parsedBootstrap: unknown = null;
  if (bootstrapJson) {
    try {
      parsedBootstrap = JSON.parse(bootstrapJson);
    } catch (_error) {
      parsedBootstrap = null;
    }
  }

  const token = pickFirstString([
    seededToken,
    findTokenInObject(parsedBootstrap)
  ]);
  const userId = pickFirstString([
    seededUserId,
    findViewerUserIdFromPayload(parsedBootstrap)
  ]);

  if (!token && !userId) {
    return null;
  }

  return { token, userId };
}

async function trySessionEndpoint(url: string): Promise<SessionSnapshot | null> {
  try {
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" }
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    const token = findTokenInObject(payload);
    const userId = findViewerUserIdFromPayload(payload);
    if (!token && !userId) {
      return null;
    }
    return {
      token: findTokenInObject(payload),
      userId: findViewerUserIdFromPayload(payload)
    };
  } catch (_error) {
    return null;
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
  const userId = pickFirstString([
    record.user_id,
    record.userId,
    record.chatgpt_user_id,
    record.chatgptUserId,
    record.id
  ]);
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
