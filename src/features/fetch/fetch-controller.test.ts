import { describe, expect, it } from "vitest";
import type { FetchJobCheckpoint } from "types/domain";
import type { FetchJob } from "./source-adapters";
import {
  buildFetchResumeStateFromCheckpoints,
  buildInitialFetchProgress,
  finalizeFetchJobCheckpoint,
  getNewStoredRowIds,
  shouldStopForNoGrowthPages,
  shouldStopForStalledCursor
} from "./fetch-controller";

describe("fetch-controller helpers", () => {
  it("seeds resumed progress from persisted checkpoints", () => {
    const jobs: FetchJob[] = [
      {
        id: "character-account-appearances:crystal",
        label: "Crystal Sparkle appearances",
        source: "characterAccountAppearances",
        expected_total_count: 140000,
        character_id: "ch_crystal"
      },
      {
        id: "creator-published:darren",
        label: "Darren published",
        source: "creatorPublished",
        expected_total_count: 1083,
        creator_user_id: "user_darren"
      }
    ];
    const checkpoints = new Map<string, FetchJobCheckpoint>([
      [
        "character-account-appearances:crystal",
        {
          job_id: "character-account-appearances:crystal",
          selection_signature: "sig",
          source: "characterAccountAppearances",
          status: "running",
          fetched_rows: 120,
          processed_batches: 2,
          cursor: "cursor-2",
          previous_cursor: "cursor-1",
          offset: null,
          endpoint_key: "character-appearances",
          updated_at: "2026-04-11T00:00:00.000Z"
        }
      ],
      [
        "creator-published:darren",
        {
          job_id: "creator-published:darren",
          selection_signature: "sig",
          source: "creatorPublished",
          status: "completed",
          fetched_rows: 1083,
          processed_batches: 11,
          cursor: null,
          previous_cursor: "cursor-last",
          offset: null,
          endpoint_key: "posts",
          updated_at: "2026-04-11T00:00:00.000Z"
        }
      ]
    ]);

    const progress = buildInitialFetchProgress(jobs, checkpoints, true);

    expect(progress.active_label).toBe("Resuming Fetch…");
    expect(progress.completed_jobs).toBe(1);
    expect(progress.processed_rows).toBe(1203);
    expect(progress.processed_batches).toBe(13);
    expect(progress.job_progress.map((entry) => entry.status)).toEqual(["pending", "completed"]);
  });

  it("stops a non-offset crawl after consecutive stalled-cursor pages", () => {
    expect(
      shouldStopForStalledCursor(
        2,
        "profile"
      )
    ).toBe(true);
  });

  it("does not stop before the stalled-cursor threshold is reached", () => {
    expect(
      shouldStopForStalledCursor(
        1,
        "profile"
      )
    ).toBe(false);
  });

  it("stops a standard non-offset crawl after consecutive zero-growth pages even when cursors change", () => {
    expect(
      shouldStopForNoGrowthPages(
        3,
        100,
        "profile"
      )
    ).toBe(true);
  });

  it("does not apply the no-growth stop rule to offset-paginated sources", () => {
    expect(
      shouldStopForNoGrowthPages(
        3,
        100,
        "drafts"
      )
    ).toBe(false);
  });

  it("stops empty cursor pages after consecutive no-growth batches", () => {
    expect(
      shouldStopForNoGrowthPages(
        3,
        0,
        "profile"
      )
    ).toBe(true);
  });

  it("applies the stalled-cursor stop rule to appearance feeds now that they use server cursors", () => {
    expect(
      shouldStopForStalledCursor(
        2,
        "characterAccountAppearances"
      )
    ).toBe(true);
  });

  it("does not apply the generic no-growth stop rule to server-cursor appearance feeds", () => {
    expect(
      shouldStopForNoGrowthPages(
        3,
        100,
        "characterAccountAppearances"
      )
    ).toBe(false);
  });

  it("ignores stale checkpoints from a different selection signature", () => {
    const jobs: FetchJob[] = [
      {
        id: "profile",
        label: "My published videos",
        source: "profile",
        expected_total_count: null
      }
    ];
    const checkpoints: FetchJobCheckpoint[] = [
      {
        job_id: "profile",
        selection_signature: "other-selection",
        source: "profile",
        status: "completed",
        fetched_rows: 999,
        processed_batches: 10,
        cursor: null,
        previous_cursor: "cursor-9",
        offset: null,
        endpoint_key: "profile-feed",
        updated_at: "2026-04-11T00:00:00.000Z"
      },
      {
        job_id: "creator-published:darren",
        selection_signature: "profile||user_darren||::creatorPublished||user_darren||",
        source: "creatorPublished",
        status: "running",
        fetched_rows: 5,
        processed_batches: 1,
        cursor: "cursor-1",
        previous_cursor: null,
        offset: null,
        endpoint_key: "posts",
        updated_at: "2026-04-11T00:00:00.000Z"
      }
    ];

    const resumeState = buildFetchResumeStateFromCheckpoints(jobs, checkpoints);

    expect(resumeState.shouldResume).toBe(false);
    expect(resumeState.checkpointByJobId.size).toBe(0);
  });

  it("preserves the final cursor and endpoint when finalizing a completed checkpoint", () => {
    const job: FetchJob = {
      id: "character-account-appearances:crystal",
      label: "Crystal Sparkle appearances",
      source: "characterAccountAppearances",
      expected_total_count: null,
      character_id: "ch_crystal"
    };
    const runningCheckpoint: FetchJobCheckpoint = {
      job_id: job.id,
      selection_signature: "sig",
      source: job.source,
      status: "running",
      fetched_rows: 120,
      processed_batches: 2,
      cursor: "cursor-2",
      previous_cursor: "cursor-1",
      offset: null,
      endpoint_key: "appearances-feed",
      updated_at: "2026-04-11T00:00:00.000Z"
    };

    const completedCheckpoint = finalizeFetchJobCheckpoint(job, "sig", runningCheckpoint, {
      fetched_rows: 240,
      processed_batches: 4,
      status: "completed"
    });

    expect(completedCheckpoint.cursor).toBe("cursor-2");
    expect(completedCheckpoint.previous_cursor).toBe("cursor-1");
    expect(completedCheckpoint.endpoint_key).toBe("appearances-feed");
    expect(completedCheckpoint.status).toBe("completed");
    expect(completedCheckpoint.fetched_rows).toBe(240);
    expect(completedCheckpoint.processed_batches).toBe(4);
  });

  it("counts only newly stored row ids when resuming a repeated page", () => {
    const knownSessionRowIds = new Set(["characterAccountAppearances:s_repeat", "characterAccountAppearances:s_keep"]);

    expect(
      getNewStoredRowIds(
        [
          "characterAccountAppearances:s_repeat",
          "characterAccountAppearances:s_repeat",
          "characterAccountAppearances:s_new"
        ],
        knownSessionRowIds
      )
    ).toEqual(["characterAccountAppearances:s_new"]);
  });
});
