import { describe, expect, it } from "vitest";
import { resolveHoverGifUrl } from "./video-playback";

describe("resolveHoverGifUrl", () => {
  it("prefers an explicit gif_url on the row", () => {
    const gifUrl = "https://videos.openai.com/az/files/explicit-gif/raw";
    expect(resolveHoverGifUrl({ gif_url: gifUrl, raw_payload_json: "" })).toBe(gifUrl);
  });

  it("resolves only post.attachments[0].encodings.gif.path", () => {
    const expectedUrl =
      "https://videos.openai.com/az/files/41807258bf4162f_00000000-6970-7282-aba9-b412d6a367ef/drvs/gif/raw?sig=abc123";
    const rawPayload = JSON.stringify({
      post: {
        attachments: [
          {
            encodings: {
              gif: {
                path: expectedUrl
              }
            }
          }
        ]
      }
    });

    expect(resolveHoverGifUrl({ raw_payload_json: rawPayload })).toBe(expectedUrl);
  });

  it("returns empty when gif path exists only at attachments[1]", () => {
    const expectedUrl = "https://videos.openai.com/singular-gif.gif";
    const rawPayload = JSON.stringify({
      post: {
        attachments: [
          {},
          {
            encodings: {
              gif: {
                path: expectedUrl
              }
            }
          }
        ]
      }
    });

    expect(resolveHoverGifUrl({ raw_payload_json: rawPayload })).toBe("");
  });

  it("returns empty for non-exact payload shapes like items[*].post.attachments", () => {
    const expectedUrl = "https://videos.openai.com/items-gif.gif";
    const rawPayload = JSON.stringify({
      items: [
        {
          post: {
            attachments: [
              {
                encodings: {
                  gif: {
                    path: expectedUrl
                  }
                }
              }
            ]
          }
        }
      ]
    });

    expect(resolveHoverGifUrl({ raw_payload_json: rawPayload })).toBe("");
  });

  it("returns empty when exact path is not present", () => {
    const rawPayload = JSON.stringify({
      post: {
        attachments: [
          {
            encodings: {
              thumbnail: { path: "https://videos.openai.com/thumb.jpg" }
            }
          }
        ]
      }
    });

    expect(resolveHoverGifUrl({ raw_payload_json: rawPayload })).toBe("");
  });
});
