import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBanner } from "./progress-banner";

describe("ProgressBanner", () => {
  it("renders worker cards for download jobs with multiple workers", () => {
    render(
      <ProgressBanner
        phase="downloading"
        fetchProgress={{
          active_label: "",
          completed_jobs: 0,
          processed_batches: 0,
          processed_rows: 0,
          running_jobs: 0,
          total_jobs: 0,
          job_progress: []
        }}
        downloadProgress={{
          active_label: "Bundling Alpha",
          completed_items: 4,
          running_workers: 2,
          total_items: 10,
          total_workers: 3,
          worker_progress: [
            {
              worker_id: "zip-worker-1",
              label: "Worker 1",
              status: "running",
              completed_items: 2,
              active_item_label: "Alpha",
              last_completed_item_label: ""
            },
            {
              worker_id: "zip-worker-2",
              label: "Worker 2",
              status: "completed",
              completed_items: 2,
              active_item_label: "",
              last_completed_item_label: "Beta"
            },
            {
              worker_id: "zip-worker-3",
              label: "Worker 3",
              status: "pending",
              completed_items: 0,
              active_item_label: "",
              last_completed_item_label: ""
            }
          ]
        }}
      />
    );

    expect(screen.getByText("Bundling Alpha")).toBeInTheDocument();
    expect(screen.getByText("4/10 bundled")).toBeInTheDocument();
    expect(screen.getByText("Worker 1")).toBeInTheDocument();
    expect(screen.getByText("2 items · Bundling Alpha")).toBeInTheDocument();
    expect(screen.getByText("2 items · Last bundled Beta")).toBeInTheDocument();
    expect(screen.getByText("0 items · Waiting for work")).toBeInTheDocument();
  });

  it("shows waiting copy and expected totals for a running fetch with no streamed rows yet", () => {
    render(
      <ProgressBanner
        phase="fetching"
        fetchProgress={{
          active_label: "Fetching Crystal Sparkle appearances · 0 / 140,000 rows",
          completed_jobs: 1,
          processed_batches: 0,
          processed_rows: 0,
          running_jobs: 1,
          total_jobs: 2,
          job_progress: [
            {
              job_id: "character-account-appearances:crystal",
              label: "Crystal Sparkle appearances",
              source: "characterAccountAppearances",
              status: "running",
              fetched_rows: 0,
              processed_batches: 0,
              expected_total_count: 140000
            }
          ]
        }}
        downloadProgress={{
          active_label: "",
          completed_items: 0,
          running_workers: 0,
          total_items: 0,
          total_workers: 0,
          worker_progress: []
        }}
      />
    );

    expect(screen.getByText("Fetching Crystal Sparkle appearances · 0 / 140,000 rows")).toBeInTheDocument();
    expect(screen.getByText("0 / 140,000 rows · Waiting for first page")).toBeInTheDocument();
  });
});
