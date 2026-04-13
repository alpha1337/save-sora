import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoRow } from "types/domain";
import { ResultsPanel } from "./results-panel";

const emptyDownloadProgress = {
  active_label: "",
  completed_items: 0,
  running_workers: 0,
  total_items: 0,
  total_workers: 0,
  worker_progress: []
};
const emptyFetchProgress = {
  active_label: "",
  completed_jobs: 0,
  processed_batches: 0,
  processed_rows: 0,
  running_jobs: 0,
  total_jobs: 0,
  job_progress: []
};

const baseRow: VideoRow = {
  row_id: "row-1",
  video_id: "s_123",
  source_type: "profile",
  source_bucket: "published",
  title: "Alpha",
  prompt: "",
  discovery_phrase: "",
  description: "",
  caption: "",
  creator_name: "Creator",
  creator_username: "creator",
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
  playback_url: "",
  duration_seconds: null,
  estimated_size_bytes: null,
  width: null,
  height: null,
  raw_payload_json: "",
  is_downloadable: true,
  skip_reason: "",
  fetched_at: "2026-04-11T00:00:00.000Z"
};

describe("ResultsPanel", () => {
  it("surfaces total session counts separately from filtered results", () => {
    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={120000}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasRows
        hasQuery
        groupBy="none"
        phase="ready"
        onDownload={vi.fn()}
        onExportCsv={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query="alpha"
        rows={[baseRow]}
        selectableRowCount={1}
        selectedDownloadableRowCount={12}
        selectedBytes={1024 * 1024 * 3}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={124000}
      />
    );

    expect(screen.getByText("Selected Size")).toBeInTheDocument();
    expect(screen.queryByText("Processing")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for download")).not.toBeInTheDocument();
  });

  it("explains when search hides rows already fetched into the session", () => {
    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={120000}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasRows
        hasQuery
        groupBy="none"
        phase="ready"
        onDownload={vi.fn()}
        onExportCsv={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query="missing"
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={124000}
      />
    );

    expect(screen.getByText("No rows match your filters.")).toBeInTheDocument();
  });

  it("renders grouped sections when grouping is enabled", () => {
    const rowTwo: VideoRow = {
      ...baseRow,
      row_id: "row-2",
      video_id: "s_234",
      title: "Beta",
      creator_name: "Second Creator"
    };

    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={2}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasRows
        hasQuery={false}
        groupBy="creator"
        phase="ready"
        onDownload={vi.fn()}
        onExportCsv={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[baseRow, rowTwo]}
        selectableRowCount={2}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={2}
      />
    );

    expect(screen.getAllByText(/1 videos/)).toHaveLength(2);
    expect(screen.getAllByText("Second Creator")).toHaveLength(2);
  });

  it("bulk selects all selectable cards in a group when group checkbox is toggled", () => {
    const rowTwo: VideoRow = {
      ...baseRow,
      row_id: "row-2",
      video_id: "s_234",
      title: "Beta"
    };
    const onSetSelectedVideoIds = vi.fn();

    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={2}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasRows
        hasQuery={false}
        groupBy="creator"
        phase="ready"
        onDownload={vi.fn()}
        onExportCsv={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={onSetSelectedVideoIds}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[baseRow, rowTwo]}
        selectableRowCount={2}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={2}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Creator" }));
    expect(onSetSelectedVideoIds).toHaveBeenCalledWith(["s_123", "s_234"]);
  });
});
