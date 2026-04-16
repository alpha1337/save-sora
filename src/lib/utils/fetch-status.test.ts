import { describe, expect, it } from "vitest";
import type { FetchProgressState } from "types/domain";
import {
  buildFetchBatchErrorWithContext,
  getFetchBatchCompleteLabel,
  getFetchJobStatusLabel,
  getFetchReceivedBatchLabel,
  getFetchRequestingBatchLabel,
  getFetchResolvingDraftIdsLabel,
  getFetchSavingCheckpointLabel,
  pickFetchActiveItemTitle
} from "./fetch-status";

describe("fetch-status", () => {
  it("returns processing labels for draft and non-draft sources", () => {
    expect(
      pickFetchActiveItemTitle(
        [{ row_id: "drafts:1", title: "My Draft", video_id: "s_123" }],
        "drafts"
      )
    ).toBe("Processing draft My Draft...");

    expect(
      pickFetchActiveItemTitle(
        [{ row_id: "profile:s_123", title: "My Published", video_id: "s_123" }],
        "profile"
      )
    ).toBe("Processing My Published...");
  });

  it("builds job fallback labels from status", () => {
    const pending: FetchProgressState["job_progress"][number] = {
      job_id: "job-1",
      label: "Job",
      source: "profile",
      status: "pending",
      fetched_rows: 0,
      processed_batches: 0,
      expected_total_count: null
    };

    const running = { ...pending, status: "running" as const, processed_batches: 2 };
    const completed = { ...pending, status: "completed" as const };

    expect(getFetchJobStatusLabel(pending)).toBe("Queued");
    expect(getFetchJobStatusLabel(running)).toBe("Fetching page 3...");
    expect(getFetchJobStatusLabel(completed)).toBe("Complete!");
  });

  it("builds stage labels for fetch actions", () => {
    expect(getFetchRequestingBatchLabel(1, "drafts", "drafts-v2")).toBe("Requesting drafts-v2 page 1...");
    expect(getFetchReceivedBatchLabel(2, 100, "profile", "profile-feed")).toBe("Received 100 rows from profile-feed page 2");
    expect(getFetchResolvingDraftIdsLabel(3, 10)).toBe("Resolving draft IDs 3/10...");
    expect(getFetchSavingCheckpointLabel(4)).toBe("Saving checkpoint after page 4...");
    expect(getFetchBatchCompleteLabel(5, 12, 44)).toBe("Page 5 complete · +12 rows · 44 total");
  });

  it("annotates fetch errors with debug context", () => {
    const error = buildFetchBatchErrorWithContext(new Error("Sora request failed with status 400."), {
      batchNumber: 2,
      cursor: "cursor_abc123",
      endpointKey: "creator-published",
      jobLabel: "Quiet Takes published",
      offset: 0,
      source: "creatorPublished"
    });

    expect(error.message).toContain("Sora request failed with status 400.");
    expect(error.message).toContain("Context:");
    expect(error.message).toContain("job=Quiet Takes published");
    expect(error.message).toContain("source=creatorPublished");
  });
});
