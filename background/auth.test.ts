import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_PAYLOAD = {
  accessToken: "eyJhbGciOiJS.test.token",
  user: { id: "user-hpMzqszkKps0XRRewJj8bxER" }
};

describe("injected auth bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: sessionStorage, configurable: true });
    document.cookie = "oai-did=test-device-id";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the live session endpoint token when storage is empty", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://sora.chatgpt.com/api/auth/session") {
        return new Response(JSON.stringify(SESSION_PAYLOAD), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { deriveAuthContext, deriveViewerUserId } = await import("../injected/lib/auth");
    const auth = await deriveAuthContext();
    const viewerUserId = await deriveViewerUserId();

    expect(auth.token).toBe(SESSION_PAYLOAD.accessToken);
    expect(auth.deviceId).toBe("test-device-id");
    expect(viewerUserId).toBe(SESSION_PAYLOAD.user.id);
    expect(fetchMock).toHaveBeenCalled();
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
