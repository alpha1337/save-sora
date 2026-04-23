import { beforeEach, describe, expect, it } from "vitest";
import type { FetchJobCheckpoint, VideoRow } from "types/domain";
import {
  clearFetchCacheDatabase,
  hasResumableLatestSelectionCheckpoint,
  loadAllFetchRows,
  loadFetchCheckpointsForJobs,
  loadFetchRowsForJobs,
  loadLatestSelectionFetchRows,
  loadRecentFetchRows,
  openFetchCacheDb,
  saveFetchBatchState,
  saveFetchRowsForJob
} from "./fetch-cache-db";

function createRow(rowId: string, sourceType = "profile"): VideoRow {
  return {
    row_id: rowId,
    video_id: rowId,
    source_type: sourceType,
    source_bucket: "published",
    title: rowId,
    prompt: "",
    discovery_phrase: "",
    description: "",
    caption: "",
    creator_name: "",
    creator_username: "",
    character_name: "",
    character_username: "",
    character_names: [],
    category_tags: [],
    created_at: null,
    published_at: null,
    like_count: null,
    view_count: null,
    share_count: null,
    repost_count: null,
    remix_count: null,
    detail_url: "",
    thumbnail_url: "",
    gif_url: "",
    playback_url: "",
    duration_seconds: null,
    estimated_size_bytes: null,
    width: null,
    height: null,
    raw_payload_json: "",
    source_order: null,
    is_downloadable: true,
    skip_reason: "",
    fetched_at: new Date().toISOString()
  };
}

function createCheckpoint(jobId: string, status: "running" | "completed" = "running", updatedAt?: string): FetchJobCheckpoint {
  return {
    job_id: jobId,
    selection_signature: "sig",
    source: "profile",
    status,
    fetched_rows: 2,
    processed_batches: 1,
    cursor: "cursor-1",
    previous_cursor: null,
    offset: null,
    endpoint_key: "profile",
    updated_at: updatedAt ?? new Date().toISOString()
  };
}

describe("fetch-cache-db", () => {
  beforeEach(async () => {
    const database = await openFetchCacheDb();
    await database.clear("rows");
    await database.clear("job_rows");
    await database.clear("checkpoints");
  });

  it("persists rows and checkpoints per job", async () => {
    const checkpoint = createCheckpoint("job-a");
    await saveFetchBatchState("job-a", [createRow("row-1"), createRow("row-2")], checkpoint);

    await expect(loadFetchRowsForJobs(["job-a"])).resolves.toHaveLength(2);
    await expect(loadFetchCheckpointsForJobs(["job-a"])).resolves.toEqual([checkpoint]);
  });

  it("prunes stale checkpoints", async () => {
    const staleDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString();
    await saveFetchBatchState("job-a", [createRow("row-1")], createCheckpoint("job-a", "running", staleDate));

    await expect(loadFetchCheckpointsForJobs(["job-a"])).resolves.toEqual([]);
  });

  it("clears persisted fetch cache data", async () => {
    await saveFetchBatchState("job-a", [createRow("row-1")], createCheckpoint("job-a"));
    await clearFetchCacheDatabase();

    await expect(loadFetchRowsForJobs(["job-a"])).resolves.toEqual([]);
    await expect(loadFetchCheckpointsForJobs(["job-a"])).resolves.toEqual([]);
  });

  it("loads all cached rows regardless of job id", async () => {
    await saveFetchBatchState("job-a", [createRow("row-1")], createCheckpoint("job-a"));
    await saveFetchBatchState("job-b", [createRow("row-2", "sideCharacter")], createCheckpoint("job-b"));

    const rows = await loadAllFetchRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.row_id).sort()).toEqual(["row-1", "row-2"]);
  });

  it("loads recent unique rows for fast bootstrap hydration", async () => {
    await saveFetchRowsForJob("job-a", [createRow("row-1"), createRow("row-2")]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveFetchRowsForJob("job-b", [createRow("row-2"), createRow("row-3")]);

    const rows = await loadRecentFetchRows(2);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.row_id).sort()).toEqual(["row-2", "row-3"]);
  });

  it("stores job rows without mutating checkpoint state", async () => {
    const checkpoint = createCheckpoint("job-a");
    await saveFetchBatchState("job-a", [createRow("row-1")], checkpoint);
    await saveFetchRowsForJob("job-a", [createRow("row-2"), createRow("row-3")]);

    await expect(loadFetchRowsForJobs(["job-a"])).resolves.toHaveLength(3);
    await expect(loadFetchCheckpointsForJobs(["job-a"])).resolves.toEqual([checkpoint]);
  });

  it("hydrates rows for the latest checkpoint selection signature", async () => {
    const olderSignature = "sig-old";
    const latestSignature = "sig-latest";
    const olderUpdatedAt = new Date(Date.now() - 10_000).toISOString();
    const latestUpdatedAt = new Date().toISOString();

    await saveFetchBatchState(
      "job-old",
      [createRow("row-old")],
      { ...createCheckpoint("job-old"), selection_signature: olderSignature, updated_at: olderUpdatedAt }
    );
    await saveFetchBatchState(
      "job-latest-a",
      [createRow("row-new-a")],
      { ...createCheckpoint("job-latest-a"), selection_signature: latestSignature, updated_at: latestUpdatedAt }
    );
    await saveFetchBatchState(
      "job-latest-b",
      [createRow("row-new-b")],
      { ...createCheckpoint("job-latest-b"), selection_signature: latestSignature, updated_at: latestUpdatedAt }
    );

    const rows = await loadLatestSelectionFetchRows();
    expect(rows.map((row) => row.row_id).sort()).toEqual(["row-new-a", "row-new-b"]);
  });

  it("reports resumable=true when latest selection has unfinished checkpoints", async () => {
    await saveFetchBatchState(
      "job-old",
      [createRow("row-old")],
      { ...createCheckpoint("job-old", "completed"), selection_signature: "sig-old", updated_at: new Date(Date.now() - 10_000).toISOString() }
    );
    await saveFetchBatchState(
      "job-new-running",
      [createRow("row-new")],
      { ...createCheckpoint("job-new-running", "running"), selection_signature: "sig-new", updated_at: new Date().toISOString() }
    );

    await expect(hasResumableLatestSelectionCheckpoint()).resolves.toBe(true);
  });

  it("reports resumable=false when latest selection checkpoints are all completed", async () => {
    const updatedAt = new Date().toISOString();
    await saveFetchBatchState(
      "job-new-a",
      [createRow("row-new-a")],
      { ...createCheckpoint("job-new-a", "completed"), selection_signature: "sig-new", updated_at: updatedAt }
    );
    await saveFetchBatchState(
      "job-new-b",
      [createRow("row-new-b")],
      { ...createCheckpoint("job-new-b", "completed"), selection_signature: "sig-new", updated_at: updatedAt }
    );

    await expect(hasResumableLatestSelectionCheckpoint()).resolves.toBe(false);
  });
});
