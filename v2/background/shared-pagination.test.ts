import { describe, expect, it } from "vitest";
import { getNextCursorForRows } from "../injected/lib/shared";

describe("shared pagination helpers", () => {
  it("returns an explicit cursor when the payload provides one", () => {
    expect(
      getNextCursorForRows(
        {
          next_cursor: "explicit-cursor"
        },
        [],
        ""
      )
    ).toBe("explicit-cursor");
  });

  it("derives a created-at cursor from rows when the payload omits one", () => {
    const derivedCursor = getNextCursorForRows(
      {
        items: [
          { post: { id: "s_alpha", posted_at: 1775600000 } },
          { post: { id: "s_beta", posted_at: 1775500000 } }
        ]
      },
      [
        { post: { id: "s_alpha", posted_at: 1775600000 } },
        { post: { id: "s_beta", posted_at: 1775500000 } }
      ],
      "",
      "sv2_created_at"
    );

    expect(derivedCursor).toBeTruthy();
    expect(JSON.parse(atob(derivedCursor as string))).toEqual({
      kind: "sv2_created_at",
      created_at: 1775500000
    });
  });
});
