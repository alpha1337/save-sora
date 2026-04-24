import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveKontenAiLinks } from "./kontenai-links";

describe("KontenAI links resolver", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns links.mp4_wm_source from the background endpoint request", async () => {
    const videoId = "s_69e81416de6c8191a0fd3ee91461499c";
    const expectedUrl = "https://videos.openai.com/az/files/00000000-539c-7284-80ec-07117587445a%2Fraw?se=2026-04-30T03%3A00%3A00Z";
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      links: {
        mp4_wm_source: expectedUrl
      }
    }), {
      headers: { "content-type": "application/json" },
      status: 200
    })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveKontenAiLinks(videoId);

    expect(result).toBe(expectedUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dyysy.com/links20260207/https%3A%2F%2Fsora.chatgpt.com%2Fp%2Fs_69e81416de6c8191a0fd3ee91461499c",
      {
        cache: "no-store",
        headers: {
          accept: "application/json"
        }
      }
    );
  });

  it("returns null for terminal miss statuses", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 422 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveKontenAiLinks("s_unavailable_source")).resolves.toBeNull();
  });
});
