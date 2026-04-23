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

  it("preserves requested limits for every source", () => {
    expect(getFetchLimitForSource("profile", 100)).toBe(100);
    expect(getFetchLimitForSource("drafts", 100)).toBe(100);
    expect(getFetchLimitForSource("likes", 100)).toBe(100);
    expect(getFetchLimitForSource("creatorPublished", 100)).toBe(100);
    expect(getFetchLimitForSource("characters", 100)).toBe(100);
    expect(getFetchLimitForSource("characterAccountAppearances", 8)).toBe(8);
    expect(getFetchLimitForSource("creatorCameos", 8)).toBe(8);
    expect(getFetchLimitForSource("characterDrafts", 100)).toBe(100);
  });

  it("continues non-offset sources while a next cursor exists", () => {
    expect(shouldFinishFetchPage("profile", 0, "cursor-2", false)).toBe(false);
    expect(shouldFinishFetchPage("characterAccountAppearances", 0, "cursor-2", false)).toBe(false);
  });

  it("stops non-offset sources immediately when the server cursor is missing", () => {
    expect(shouldFinishFetchPage("profile", 0, null, false)).toBe(true);
    expect(shouldFinishFetchPage("profile", 100, null, true)).toBe(true);
    expect(shouldFinishFetchPage("characterAccountAppearances", 0, null, false)).toBe(true);
  });

  it("returns getSoraWatermarkTask.data as the endpoint payload", async () => {
    const taskId = "94976234-40cb-4e2f-8999-b411b7f9e55f";
    const sourceUrl = "https://sora.chatgpt.com/p/s_69e87b6d054c81919e111296af449910";
    const uuid = "eaa665130fc1a1d2f3acc5c5265a1c00ddd9924fc6d20566___";
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://crx-api.savev.co/v2/oversea-extension/soraWatermark/soraWatermarkTask")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: taskId,
            message: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSourceRequest({
      type: "get-sora-watermark-task",
      url: sourceUrl,
      uuid
    });

    expect(result).toBe(taskId);
    const requestedUrl = fetchMock.mock.calls[0]?.[0];
    const normalizedUrl = typeof requestedUrl === "string"
      ? requestedUrl
      : requestedUrl instanceof URL
        ? requestedUrl.toString()
        : requestedUrl?.url ?? "";
    const parsedRequestUrl = new URL(normalizedUrl);
    expect(parsedRequestUrl.pathname).toBe("/v2/oversea-extension/soraWatermark/soraWatermarkTask");
    expect(parsedRequestUrl.searchParams.get("url")).toBe(sourceUrl);
    expect(parsedRequestUrl.searchParams.get("uuid")).toBe(uuid);
  });

  it("returns getSoraWatermarkFreeVideo.data as URL string or null", async () => {
    const taskId = "8f2d1eb5-465a-426e-a426-23ecc7f219d5";
    const videoUrl = "https://videos.openai.com/az/files/00000000-f650-7283-a756-228e8893cdb3%2Fraw";
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/queryTask?taskId=task-ready")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: videoUrl,
            message: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes(`/queryTask?taskId=${taskId}`)) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: null,
            message: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pendingResult = await runSourceRequest({
      type: "get-sora-watermark-free-video",
      task_id: taskId
    });
    const readyResult = await runSourceRequest({
      type: "get-sora-watermark-free-video",
      task_id: "task-ready"
    });

    expect(pendingResult).toBeNull();
    expect(readyResult).toBe(videoUrl);
  });

  it("advances likes pagination with offset when cursor is absent", async () => {
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
      if (url.includes("/backend/project_y/profile/user-hpMzqszkKps0XRRewJj8bxER/post_listing/likes?limit=2&offset=0")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_like_1" } }, { post: { id: "s_like_2" } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/backend/project_y/profile/user-hpMzqszkKps0XRRewJj8bxER/post_listing/likes?limit=2&offset=2")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_like_3" } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPage = await runSourceRequest({
      type: "fetch-batch",
      source: "likes",
      limit: 2,
      offset: 0,
      page_budget: 1
    });
    const secondPage = await runSourceRequest({
      type: "fetch-batch",
      source: "likes",
      limit: 2,
      offset: (firstPage as { next_offset?: number | null }).next_offset ?? 0,
      page_budget: 1
    });

    expect(firstPage).toMatchObject({
      endpoint_key: "likes",
      next_cursor: null,
      next_offset: 2,
      done: false,
      rows: [
        { post: { id: "s_like_1" }, __save_sora_like_rank: 0 },
        { post: { id: "s_like_2" }, __save_sora_like_rank: 1 }
      ]
    });
    expect(secondPage).toMatchObject({
      endpoint_key: "likes",
      next_cursor: null,
      next_offset: 3,
      done: true,
      rows: [{ post: { id: "s_like_3" }, __save_sora_like_rank: 2 }]
    });
  });

  it("advances likes offset even when the API also returns a cursor", async () => {
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
      if (url.includes("/post_listing/likes?limit=2&offset=0")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_like_cursor_1" } }, { post: { id: "s_like_cursor_2" } }],
            cursor: "cursor-2"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/post_listing/likes?limit=2&cursor=cursor-2")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_like_cursor_3" } }],
            cursor: ""
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPage = await runSourceRequest({
      type: "fetch-batch",
      source: "likes",
      limit: 2,
      offset: 0,
      page_budget: 1
    });
    const secondPage = await runSourceRequest({
      type: "fetch-batch",
      source: "likes",
      cursor: (firstPage as { next_cursor?: string | null }).next_cursor ?? null,
      offset: (firstPage as { next_offset?: number | null }).next_offset ?? 0,
      limit: 2,
      page_budget: 1
    });

    expect(firstPage).toMatchObject({
      next_cursor: "cursor-2",
      next_offset: 2
    });
    expect(secondPage).toMatchObject({
      next_offset: 3,
      rows: [{ post: { id: "s_like_cursor_3" }, __save_sora_like_rank: 2 }]
    });
  });

  it("locks character appearances to the profile-feed appearances contract", async () => {
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
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cut=appearances")) {
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
      endpoint_key: "character-feed-appearances",
      next_cursor: "appearance-next-cursor",
      rows: appearancesPayload.items
    });
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    const characterFeedRequest = requestedUrls.find((url) => url.includes("/backend/project_y/profile_feed/ch_123?")) ?? "";
    expect(characterFeedRequest.includes("cut=appearances")).toBe(true);
    expect(characterFeedRequest.includes("cursor=")).toBe(false);
    expect(requestedUrls.some((url) => url.includes("limit=100"))).toBe(true);
  });

  it("locks side-character fetches to ch_* appearances with no page-0 cursor", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const profileLookupPayload = {
      user_id: "user-owner-1",
      username: "crystal.party",
      character_user_id: "ch_123"
    };
    const appearancesPayload = {
      items: [{ post: { id: "s_a1", posted_at: 1775636364.275118 } }],
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
      if (url.includes("/backend/project_y/profile/username/crystal.party") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify(profileLookupPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cut=appearances")) {
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
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      limit: 8,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "side-character-feed-appearances",
      next_cursor: "appearance-next-cursor",
      rows: appearancesPayload.items
    });

    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    const sideCharacterRequest = requestedUrls.find((url) => url.includes("/backend/project_y/profile_feed/ch_123?")) ?? "";
    expect(sideCharacterRequest.includes("cut=appearances")).toBe(true);
    expect(sideCharacterRequest.includes("limit=8")).toBe(true);
    expect(sideCharacterRequest.includes("cursor=")).toBe(false);
    expect(requestedUrls.some((url) => url.includes("cut=nf2"))).toBe(false);
  });

  it("resolves side-character ch_* id via appearances probe when profile lookup omits character_user_id", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const profileLookupPayload = {
      user_id: "user-owner-1",
      username: "next.thur.thursday"
    };
    const usernameAppearancesProbePayload = {
      items: [
        {
          post: {
            id: "s_probe_1",
            cameo_profiles: [
              {
                user_id: "ch_6955e4af0b5c81919019718b9c157e83",
                username: "next.thur.thursday"
              }
            ]
          }
        }
      ],
      cursor: "probe-next-cursor"
    };
    const appearancesPayload = {
      items: [{ post: { id: "s_a1", posted_at: 1775636364.275118 } }],
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
      if (url.includes("/backend/project_y/profile/username/next.thur.thursday") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify(profileLookupPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/username/next.thur.thursday?") && url.includes("cut=appearances")) {
        return new Response(JSON.stringify(usernameAppearancesProbePayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_6955e4af0b5c81919019718b9c157e83?") && url.includes("cut=appearances")) {
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
      source: "sideCharacter",
      creator_username: "next.thur.thursday",
      route_url: "https://sora.chatgpt.com/profile/next.thur.thursday",
      limit: 8,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "side-character-feed-appearances",
      next_cursor: "appearance-next-cursor",
      rows: appearancesPayload.items
    });

    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls.some((url) => url.includes("/backend/project_y/profile_feed/username/next.thur.thursday?") && url.includes("cut=appearances"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/backend/project_y/profile_feed/ch_6955e4af0b5c81919019718b9c157e83?") && url.includes("cut=appearances"))).toBe(true);
  });

  it("chains side-character cursors exactly and ends when server cursor becomes null", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const profileLookupPayload = {
      user_id: "user-owner-1",
      username: "crystal.party",
      character_user_id: "ch_123"
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/username/crystal.party") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify(profileLookupPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cut=appearances") && !url.includes("cursor=")) {
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_page_0", posted_at: 1775636364.275118 } }],
          cursor: "cursor-page-1"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cursor=cursor-page-1")) {
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_page_1", posted_at: 1775636300.111111 } }],
          cursor: "cursor-page-2"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cursor=cursor-page-2")) {
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_page_2", posted_at: 1775636200.111111 } }],
          cursor: null
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      limit: 8,
      page_budget: 1
    });
    const secondPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      cursor: (firstPage as { next_cursor?: string | null }).next_cursor ?? null,
      limit: 8,
      page_budget: 1
    });
    const thirdPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      cursor: (secondPage as { next_cursor?: string | null }).next_cursor ?? null,
      limit: 8,
      page_budget: 1
    });

    expect(firstPage).toMatchObject({
      next_cursor: "cursor-page-1",
      rows: [{ post: { id: "s_page_0", posted_at: 1775636364.275118 } }]
    });
    expect(secondPage).toMatchObject({
      next_cursor: "cursor-page-2",
      rows: [{ post: { id: "s_page_1", posted_at: 1775636300.111111 } }]
    });
    expect(thirdPage).toMatchObject({
      next_cursor: null,
      done: true,
      rows: [{ post: { id: "s_page_2", posted_at: 1775636200.111111 } }]
    });

    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    const feedRequests = requestedUrls.filter((url) => url.includes("/backend/project_y/profile_feed/ch_123?"));
    expect(feedRequests).toHaveLength(3);
    expect(feedRequests[0]?.includes("cursor=")).toBe(false);
    expect(feedRequests[1]?.includes("cursor=cursor-page-1")).toBe(true);
    expect(feedRequests[2]?.includes("cursor=cursor-page-2")).toBe(true);
  });

  it("retries side-character pages on 429 without skipping cursor-linked pages", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const profileLookupPayload = {
      user_id: "user-owner-1",
      username: "crystal.party",
      character_user_id: "ch_123"
    };
    let pageZeroAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/username/crystal.party") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify(profileLookupPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cut=appearances") && !url.includes("cursor=")) {
        pageZeroAttempts += 1;
        if (pageZeroAttempts === 1) {
          return new Response(JSON.stringify({ error: "rate-limited" }), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "0"
            }
          });
        }
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_retry_page_0", posted_at: 1775636364.275118 } }],
          cursor: "cursor-retry-1"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cursor=cursor-retry-1")) {
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_retry_page_1", posted_at: 1775636300.111111 } }],
          cursor: null
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      limit: 8,
      page_budget: 1
    });
    const secondPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      cursor: (firstPage as { next_cursor?: string | null }).next_cursor ?? null,
      limit: 8,
      page_budget: 1
    });

    expect(firstPage).toMatchObject({
      next_cursor: "cursor-retry-1",
      rows: [{ post: { id: "s_retry_page_0", posted_at: 1775636364.275118 } }],
      request_diagnostics: {
        status: 200,
        attempts: 2,
        cursor_in: null,
        cursor_out: "cursor-retry-1",
        rate_limited: true
      }
    });
    expect(secondPage).toMatchObject({
      next_cursor: null,
      rows: [{ post: { id: "s_retry_page_1", posted_at: 1775636300.111111 } }],
      request_diagnostics: {
        status: 200,
        attempts: 1,
        cursor_in: "cursor-retry-1",
        cursor_out: null,
        rate_limited: false
      }
    });
    const collectedIds = [
      ...((firstPage as { rows: Array<{ post: { id: string } }> }).rows.map((row) => row.post.id)),
      ...((secondPage as { rows: Array<{ post: { id: string } }> }).rows.map((row) => row.post.id))
    ];
    expect(collectedIds).toEqual(["s_retry_page_0", "s_retry_page_1"]);
  });

  it("retries side-character pages on network failures without skipping cursor-linked pages", async () => {
    const sessionPayload = {
      accessToken: "eyJhbGciOiJS.test.token",
      user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
    };
    const profileLookupPayload = {
      user_id: "user-owner-1",
      username: "crystal.party",
      character_user_id: "ch_123"
    };
    let pageZeroAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile/username/crystal.party") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify(profileLookupPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cut=appearances") && !url.includes("cursor=")) {
        pageZeroAttempts += 1;
        if (pageZeroAttempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_net_retry_page_0", posted_at: 1775636364.275118 } }],
          cursor: "cursor-net-retry-1"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_123?") && url.includes("cursor=cursor-net-retry-1")) {
        return new Response(JSON.stringify({
          items: [{ post: { id: "s_net_retry_page_1", posted_at: 1775636300.111111 } }],
          cursor: null
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      limit: 8,
      page_budget: 1
    });
    const secondPage = await runSourceRequest({
      type: "fetch-batch",
      source: "sideCharacter",
      creator_username: "crystal.party",
      route_url: "https://sora.chatgpt.com/profile/crystal.party",
      cursor: (firstPage as { next_cursor?: string | null }).next_cursor ?? null,
      limit: 8,
      page_budget: 1
    });

    expect(firstPage).toMatchObject({
      next_cursor: "cursor-net-retry-1",
      rows: [{ post: { id: "s_net_retry_page_0", posted_at: 1775636364.275118 } }],
      request_diagnostics: {
        status: 200,
        attempts: 2,
        network_errors: 1,
        cursor_in: null,
        cursor_out: "cursor-net-retry-1",
        rate_limited: false
      }
    });
    expect(secondPage).toMatchObject({
      next_cursor: null,
      rows: [{ post: { id: "s_net_retry_page_1", posted_at: 1775636300.111111 } }],
      request_diagnostics: {
        status: 200,
        attempts: 1,
        network_errors: 0,
        cursor_in: "cursor-net-retry-1",
        cursor_out: null,
        rate_limited: false
      }
    });
    const feedRequests = fetchMock.mock.calls
      .map(([input]) => (typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url))
      .filter((url) => url.includes("/backend/project_y/profile_feed/ch_123?"));
    expect(feedRequests).toHaveLength(3);
    expect(feedRequests[0]?.includes("cursor=")).toBe(false);
    expect(feedRequests[1]?.includes("cursor=")).toBe(false);
    expect(feedRequests[2]?.includes("cursor=cursor-net-retry-1")).toBe(true);
  });

  it("rejects character appearances fetches that cannot resolve a ch_* id", async () => {
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
      if (url.includes("/backend/project_y/profile/username/alpha1337") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify({ user_id: "user_alpha1337", username: "alpha1337" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSourceRequest({
        type: "fetch-batch",
        source: "characterAccountAppearances",
        creator_username: "alpha1337",
        limit: 8,
        page_budget: 1
      })
    ).rejects.toThrow("Character appearances fetch requires a resolvable ch_* id.");
  });

  it("locks creator published to the profile-feed nf2 contract", async () => {
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
      if (url.includes("/backend/project_y/profile/username/alpha1337") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify({ user_id: "user_alpha1337", username: "alpha1337" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/user_alpha1337?") && url.includes("cut=nf2") && url.includes("limit=8")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_feed_1", posted_at: 1775635900.111111 } }],
            total_count: 602,
            cursor: "cursor-feed"
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
      creator_username: "alpha1337",
      limit: 8,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "creator-feed-nf2",
      rows: [
        { post: { id: "s_feed_1", posted_at: 1775635900.111111 } }
      ]
    });
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    const creatorFeedRequest = requestedUrls.find((url) => url.includes("/backend/project_y/profile_feed/user_alpha1337?")) ?? "";
    expect(creatorFeedRequest.includes("cut=nf2")).toBe(true);
    expect(creatorFeedRequest.includes("cursor=")).toBe(false);
    expect(requestedUrls.some((url) => url.includes("/post_listing/"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("cut=appearances"))).toBe(false);
  });

  it("resolves creator published user id from nested profile payloads", async () => {
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
      if (url.includes("/backend/project_y/profile/username/binaryrot") && !url.includes("/post_listing/")) {
        return new Response(
          JSON.stringify({
            profile: {
              user_id: "user-yL6Ds2iYv0sIf3lMvvDpkpFB",
              username: "binaryrot",
              post_count: 3016,
              cameo_count: 2537
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (
        url.includes("/backend/project_y/profile_feed/user-yL6Ds2iYv0sIf3lMvvDpkpFB?") &&
        url.includes("cut=nf2") &&
        url.includes("limit=8")
      ) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_binary_1", posted_at: 1774436220.271969 } }],
            cursor: "cursor-feed"
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
      creator_username: "binaryrot",
      limit: 8,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "creator-feed-nf2",
      rows: [{ post: { id: "s_binary_1", posted_at: 1774436220.271969 } }],
      next_cursor: "cursor-feed"
    });
  });

  it("rejects creator published fetches that cannot resolve a user_* id", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response(null, { status: 404 })));

    await expect(
      runSourceRequest({
        type: "fetch-batch",
        source: "creatorPublished",
        creator_user_id: "ch_bad",
        limit: 8,
        page_budget: 1
      })
    ).rejects.toThrow("Creator published fetch requires a resolvable user id.");
  });

  it("resolves creator cameo feeds using username-derived user ids for cast-in coverage", async () => {
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
      if (url.includes("/backend/project_y/profile/username/alpha1337") && !url.includes("/post_listing/")) {
        return new Response(JSON.stringify({ user_id: "user-hpMzqszkKps0XRRewJj8bxER", username: "alpha1337" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/backend/project_y/profile_feed/ch_wrong_creator_id") && url.includes("cut=appearances")) {
        return new Response(
          JSON.stringify({
            items: [{ post: { id: "s_wrong_scope_1", posted_at: 1775636364.275118 } }],
            cursor: ""
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (url.includes("/backend/project_y/profile_feed/user-hpMzqszkKps0XRRewJj8bxER") && url.includes("cut=appearances")) {
        return new Response(
          JSON.stringify({
            items: [
              { post: { id: "s_casted_in_1", posted_at: 1775636364.275118 } },
              { post: { id: "s_casted_in_2", posted_at: 1775636300.111111 } }
            ],
            cursor: "appearance-next-cursor"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (url.includes("/backend/project_y/profile_feed/username/alpha1337") && url.includes("cut=appearances")) {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSourceRequest({
      type: "fetch-batch",
      source: "creatorCameos",
      creator_user_id: "ch_wrong_creator_id",
      creator_username: "alpha1337",
      limit: 8,
      page_budget: 1
    });

    expect(result).toMatchObject({
      endpoint_key: "creator-appearances",
      rows: [
        { post: { id: "s_casted_in_1", posted_at: 1775636364.275118 } },
        { post: { id: "s_casted_in_2", posted_at: 1775636300.111111 } }
      ],
      next_cursor: "appearance-next-cursor"
    });
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls.some((url) => url.includes("/profile_feed/user-hpMzqszkKps0XRRewJj8bxER") && url.includes("cut=appearances"))).toBe(true);
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
