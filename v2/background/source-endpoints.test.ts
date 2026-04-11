import { describe, expect, it } from "vitest";
import { selectPreferredEndpointCandidate } from "../injected/sources/source-runner";

describe("source endpoint selection", () => {
  it("prefers the candidate that both paginates and returns rows", () => {
    const selected = selectPreferredEndpointCandidate(
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

  it("sticks with the richer payload when neither candidate paginates", () => {
    const selected = selectPreferredEndpointCandidate(
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
});
