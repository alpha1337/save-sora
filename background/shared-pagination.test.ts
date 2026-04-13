import { describe, expect, it } from "vitest";
import { getNextCursorForRows, isRetriableSoraStatus } from "../injected/lib/shared";

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

  it("stops when the derived cursor would repeat the same created-at token", () => {
    const requestCursor = btoa(
      JSON.stringify({
        kind: "sv2_created_at",
        created_at: 1775500000
      })
    );

    const derivedCursor = getNextCursorForRows(
      {
        items: [
          { post: { id: "s_beta", posted_at: 1775500000 } }
        ]
      },
      [
        { post: { id: "s_beta", posted_at: 1775500000 } }
      ],
      requestCursor,
      "sv2_created_at"
    );

    expect(derivedCursor).toBe(requestCursor);
  });

  it("prefers explicit cursors even when they match the previous page token", () => {
    expect(
      getNextCursorForRows(
        {
          next_cursor: "cursor-page-1"
        },
        [],
        "cursor-page-2",
        "",
        "cursor-page-1"
      )
    ).toBe("cursor-page-1");
  });

  it("retries transient upstream gateway failures", () => {
    expect(isRetriableSoraStatus(524)).toBe(true);
    expect(isRetriableSoraStatus(502)).toBe(true);
    expect(isRetriableSoraStatus(404)).toBe(false);
  });
});
