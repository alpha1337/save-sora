import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DownloadProgressState } from "types/domain";
import { DownloadTakeover } from "./download-takeover";

function createProgress(overrides: Partial<DownloadProgressState> = {}): DownloadProgressState {
  return {
    active_label: "Archive Ready",
    active_subtitle: "Downloads are packaged and ready to review.",
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
    zip_part_completed_items: 2,
    zip_part_number: 1,
    zip_part_total_items: 2,
    zip_total_parts: 1,
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
    expect(screen.getByText("Archive build complete. 2 of 2 files were packaged; review any rejections before closing.")).toHaveClass("ss-download-takeover-message");
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

  it("renders a phase-prefixed current-video action subtitle", () => {
    render(
      <DownloadTakeover
        downloadProgress={createProgress({
          active_label: "Current Queue Video",
          active_subtitle: "Resolving the best available source URL.",
          preflight_stage: "resolving_sources"
        })}
        onCloseSummary={vi.fn()}
        onStartOver={vi.fn()}
        selectedBytes={1024}
        visible
      />
    );

    expect(screen.getByRole("heading", { name: "Current Queue Video" })).toBeInTheDocument();
    expect(screen.getByText("Phase 3 of 5: Resolving the best available source URL.")).toHaveClass("ss-download-takeover-subtitle");
    expect(screen.getByText("Resolving source URLs before packaging. 2 of 2 files are ready for ZIP handoff.")).toHaveClass("ss-download-takeover-message");
  });

  it("shows active ZIP progress before the first file completes", () => {
    const { container } = render(
      <DownloadTakeover
        downloadProgress={createProgress({
          active_label: "Preparing ZIP part 1/3...",
          active_subtitle: "Starting ZIP worker for part 1/3.",
          completed_items: 0,
          preflight_stage: "zipping",
          preflight_stage_label: "ZIP Worker",
          total_items: 495,
          zip_part_completed_items: 0,
          zip_part_number: 1,
          zip_part_total_items: 165,
          zip_total_parts: 3,
          zip_completed: false
        })}
        onCloseSummary={vi.fn()}
        onStartOver={vi.fn()}
        selectedBytes={1024}
        visible
      />
    );

    expect(container.querySelector(".ss-download-takeover-stage strong")).toHaveTextContent("1%");
    expect(container.querySelector(".ss-download-takeover-progress-fill")).toHaveStyle({ width: "1%" });
    expect(screen.getByText("Part 1 / 3: 0 / 165 files")).toBeInTheDocument();
    expect(screen.getByText("0 / 495 total packaged")).toBeInTheDocument();
    expect(screen.getByText("Phase 5 of 5: Starting ZIP worker for part 1/3.")).toBeInTheDocument();
    expect(screen.getByText("Packaging ZIP part 1 of 3: 0 of 165 files downloaded for this part.")).toHaveClass("ss-download-takeover-message");
  });

  it("truncates long takeover titles to 40 characters", () => {
    const longTitle = "Archive Ready".repeat(6);
    const expectedTitle = `${longTitle.slice(0, 37)}...`;

    render(
      <DownloadTakeover
        downloadProgress={createProgress({ active_label: longTitle })}
        onCloseSummary={vi.fn()}
        onStartOver={vi.fn()}
        selectedBytes={1024}
        visible
      />
    );

    expect(screen.getByRole("heading", { name: expectedTitle })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: longTitle })).not.toBeInTheDocument();
    expect(screen.getByTitle(longTitle)).toBeInTheDocument();
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
