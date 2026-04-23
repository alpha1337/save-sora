import { describe, expect, it } from "vitest";
import { getNextCursorForRows, isRetriableSoraStatus } from "../injected/lib/shared";
import { filterRowsByTimeWindow, reachedOlderThanSinceBoundary } from "../injected/sources/fetch-batch-filters";

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

  it("uses posted_at before updated_at when filtering by time window", () => {
    const sinceMs = Date.parse("2026-04-21T00:00:00.000Z");
    const rows = [
      {
        post: {
          id: "s_recent_posted",
          posted_at: "2026-04-21T10:00:00.000Z",
          updated_at: "2026-04-19T10:00:00.000Z"
        }
      },
      {
        post: {
          id: "s_old_posted",
          posted_at: "2026-04-20T10:00:00.000Z",
          updated_at: "2026-04-21T10:00:00.000Z"
        }
      }
    ];

    const filtered = filterRowsByTimeWindow(rows, sinceMs, null);
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as { post: { id: string } }).post.id).toBe("s_recent_posted");
  });

  it("uses posted_at for the older-than-since boundary stop check", () => {
    const sinceMs = Date.parse("2026-04-21T00:00:00.000Z");

    expect(
      reachedOlderThanSinceBoundary(
        [
          {
            post: {
              id: "s_recent_posted",
              posted_at: "2026-04-21T10:00:00.000Z",
              updated_at: "2026-04-19T10:00:00.000Z"
            }
          }
        ],
        sinceMs
      )
    ).toBe(false);

    expect(
      reachedOlderThanSinceBoundary(
        [
          {
            post: {
              id: "s_old_posted",
              posted_at: "2026-04-20T10:00:00.000Z",
              updated_at: "2026-04-21T10:00:00.000Z"
            }
          }
        ],
        sinceMs
      )
    ).toBe(true);
  });

  it("retries transient upstream gateway failures", () => {
    expect(isRetriableSoraStatus(524)).toBe(true);
    expect(isRetriableSoraStatus(502)).toBe(true);
    expect(isRetriableSoraStatus(404)).toBe(false);
  });
});
