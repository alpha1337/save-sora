import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFetchLimitForSource, runSourceRequest, shouldFinishFetchPage } from "../injected/sources/source-runner";

describe("source endpoint contracts", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: sessionStorage, configurable: true });
    document.cookie = "oai-did=test-device-id";
  });

  it("uses conservative limits only for server-cursor appearance feeds", () => {
    expect(getFetchLimitForSource("profile", 100)).toBe(100);
    expect(getFetchLimitForSource("creatorPublished", 100)).toBe(100);
    expect(getFetchLimitForSource("characters", 100)).toBe(100);
    expect(getFetchLimitForSource("characterAccountAppearances", 100)).toBe(100);
    expect(getFetchLimitForSource("creatorCameos", 100)).toBe(100);
  });

  it("preserves the requested limit for non-appearance sources", () => {
    expect(getFetchLimitForSource("drafts", 100)).toBe(100);
    expect(getFetchLimitForSource("likes", 100)).toBe(100);
    expect(getFetchLimitForSource("characterDrafts", 100)).toBe(100);
  });

  it("continues non-offset sources while a next cursor exists", () => {
    expect(shouldFinishFetchPage("profile", 0, "cursor-2", false)).toBe(false);
    expect(shouldFinishFetchPage("characterAccountAppearances", 0, "cursor-2", false)).toBe(false);
  });

  it("stops non-offset sources when no next cursor and page has no continuation signal", () => {
    expect(shouldFinishFetchPage("profile", 0, null, false)).toBe(true);
    expect(shouldFinishFetchPage("characterAccountAppearances", 0, null, false)).toBe(true);
  });

  it("locks character appearances to the character post-listing contract", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const appearancesPayload = {
      items: [{ post: { id: "s_a1", posted_at: 1775636364.275118 }, character_user_id: "ch_123" }],
      cursor: "appearance-next-cursor"
    };

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/ch_123/post_listing/posts")) {
        return new Response(JSON.stringify(appearancesPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSourceRequest({
      type: "fetch-batch",
      source: "characterAccountAppearances",
      character_id: "ch_123",
      limit: 100,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "character-post-listing-posts",
      next_cursor: "appearance-next-cursor",
      rows: appearancesPayload.items
    });
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls.some((url) => url.includes("/backend/project_y/profile/ch_123/post_listing/posts"))).toBe(true);
  });

  it("falls back to alternate creator published endpoints when a candidate is rejected", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/username/quiettakes")) {
        return new Response(JSON.stringify({ user_id: "user_quiettakes" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/post_listing/posts")) {
        return new Response(null, { status: 400 });
      }
      if (url.includes("/post_listing/profile")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_alt123", posted_at: 1775636364.275118 } }],
            cursor: "profile-next-cursor"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSourceRequest({
      type: "fetch-batch",
      source: "creatorPublished",
      creator_username: "quiettakes",
      limit: 100,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "creator-post-listing-profile",
      rows: [{ post: { id: "s_alt123", posted_at: 1775636364.275118 } }]
    });
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls.some((url) => url.includes("/post_listing/posts"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/post_listing/profile"))).toBe(true);
  });

  it("falls back to username-scoped creator post listing endpoints when id-scoped requests are rejected", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/username/quiettakes") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify({ user_id: "user_quiettakes", username: "quiettakes" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/user_quiettakes/post_listing/")) {
        return new Response(null, { status: 400 });
      }
      if (url.includes("/backend/project_y/profile/quiettakes/post_listing/")) {
        return new Response(null, { status: 400 });
      }
      if (url.includes("/backend/project_y/profile/username/quiettakes/post_listing/profile")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_username_path", posted_at: 1775636364.275118 } }],
            cursor: "profile-next-cursor"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (url.includes("/backend/project_y/profile/username/quiettakes/post_listing/")) {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSourceRequest({
      type: "fetch-batch",
      source: "creatorPublished",
      creator_username: "quiettakes",
      limit: 100,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "creator-post-listing-profile-username",
      rows: [{ post: { id: "s_username_path", posted_at: 1775636364.275118 } }]
    });
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls.some((url) => url.includes("/profile/user_quiettakes/post_listing/posts"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/profile/username/quiettakes/post_listing/profile"))).toBe(true);
  });
});

function createStorage(): Storage {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    }
  };

  return storage as Storage;
}
