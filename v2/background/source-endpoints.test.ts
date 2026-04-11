import { describe, expect, it } from "vitest";
import { selectPreferredEndpointCandidate, shouldFinishFetchPage } from "../injected/sources/source-runner";

describe("source endpoint selection", () => {
  it("prefers the candidate that both paginates and returns rows", () => {
    const selected = selectPreferredEndpointCandidate(
      "creatorPublished",
      [
        {
          key: "appearances",
          payload: {
            items: [{ post: { id: "s_alpha", posted_at: 1775600000 } }]
          }
        },
        {
          key: "nf2",
          payload: {
            items: [{ post: { id: "s_beta", posted_at: 1775500000 } }],
            next_cursor: "next-page"
          }
        }
      ],
      "",
      "sv2_created_at"
    );

    expect(selected?.key).toBe("nf2");
  });

  it("prefers the appearance feed for character-account appearances when it returns rows", () => {
    const selected = selectPreferredEndpointCandidate(
      "characterAccountAppearances",
      [
        {
          key: "character-appearances",
          payload: {
            items: [{ post: { id: "s_alpha", posted_at: 1775600000 } }]
          }
        },
        {
          key: "character-feed-nf2",
          payload: {
            items: [{ post: { id: "s_beta", posted_at: 1775500000 } }],
            next_cursor: "next-page"
          }
        }
      ],
      "",
      "sv2_created_at"
    );

    expect(selected?.key).toBe("character-appearances");
  });

  it("sticks with the richer payload when neither candidate paginates", () => {
    const selected = selectPreferredEndpointCandidate(
      "creatorPublished",
      [
        {
          key: "posts",
          payload: {
            items: [{ post: { id: "s_alpha", posted_at: 1775600000 } }]
          }
        },
        {
          key: "published",
          payload: {
            items: [
              { post: { id: "s_beta", posted_at: 1775500000 } },
              { post: { id: "s_gamma", posted_at: 1775400000 } }
            ]
          }
        }
      ],
      "",
      "sv2_created_at"
    );

    expect(selected?.key).toBe("published");
  });

  it("treats empty cursor pages as terminal for non-offset sources", () => {
    expect(
      shouldFinishFetchPage(
        "characterAccountAppearances",
        0,
        "cursor-2",
        false
      )
    ).toBe(true);
  });
});
