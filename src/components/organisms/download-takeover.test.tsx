import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DownloadProgressState } from "types/domain";
import { DownloadTakeover } from "./download-takeover";

function createProgress(overrides: Partial<DownloadProgressState> = {}): DownloadProgressState {
  return {
    active_label: "Archive Ready",
    completed_items: 2,
    preflight_completed_items: 2,
    preflight_stage: "completed",
    preflight_stage_label: "Summary",
    preflight_total_items: 2,
    rejection_entries: [],
    running_workers: 0,
    swimlanes: [
      { id: "drafts", label: "Drafts", items: [] },
      { id: "shared", label: "Shared", items: [] },
      { id: "processing", label: "Processing", items: [] },
      { id: "watermarked", label: "Watermarked", items: [] },
      { id: "watermark_removed", label: "Watermark Removed", items: [] }
    ],
    total_items: 2,
    total_workers: 0,
    worker_progress: [],
    zip_completed: true,
    ...overrides
  };
}

describe("DownloadTakeover", () => {
  it("stays visible after completion and renders summary CTAs", () => {
    render(
      <DownloadTakeover
        downloadProgress={createProgress()}
        onCloseSummary={vi.fn()}
        onStartOver={vi.fn()}
        selectedBytes={1024}
        visible
      />
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archive Ready" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Building Your Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Over" })).toBeInTheDocument();
  });

  it("renders rejection entries with exact item and reason", () => {
    render(
      <DownloadTakeover
        downloadProgress={createProgress({
          rejection_entries: [
            {
              id: "gen_failed",
              title: "Failed Draft",
              reason: "could_not_share_video"
            }
          ],
          swimlanes: [
            { id: "drafts", label: "Drafts", items: [] },
            { id: "shared", label: "Shared", items: [] },
            { id: "processing", label: "Processing", items: [] },
            {
              id: "watermarked",
              label: "Watermarked",
              items: [{ id: "gen_failed", title: "Failed Draft", reason: "could_not_share_video" }]
            },
            { id: "watermark_removed", label: "Watermark Removed", items: [] }
          ]
        })}
        onCloseSummary={vi.fn()}
        onStartOver={vi.fn()}
        selectedBytes={1024}
        visible
      />
    );

    expect(screen.getAllByText("Failed Draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("could_not_share_video").length).toBeGreaterThan(0);
  });

  it("truncates long rejection text to 100 characters", () => {
    const longTitle = "Failed Draft".repeat(10);
    const expectedTitle = `${longTitle.slice(0, 97)}...`;

    render(
      <DownloadTakeover
        downloadProgress={createProgress({
          rejection_entries: [
            {
              id: "gen_failed",
              title: longTitle,
              reason: "could_not_share_video"
            }
          ]
        })}
        onCloseSummary={vi.fn()}
        onStartOver={vi.fn()}
        selectedBytes={1024}
        visible
      />
    );

    expect(screen.getAllByText(expectedTitle).length).toBeGreaterThan(0);
    expect(screen.queryByText(longTitle)).not.toBeInTheDocument();
    expect(screen.getAllByTitle(longTitle).length).toBeGreaterThan(0);
  });

  it("calls close and start-over actions", () => {
    const onCloseSummary = vi.fn();
    const onStartOver = vi.fn();
    render(
      <DownloadTakeover
        downloadProgress={createProgress()}
        onCloseSummary={onCloseSummary}
        onStartOver={onStartOver}
        selectedBytes={1024}
        visible
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Over" }));

    expect(onCloseSummary).toHaveBeenCalledTimes(1);
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });
});
