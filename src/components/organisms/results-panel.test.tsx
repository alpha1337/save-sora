import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoRow } from "types/domain";
import { ResultsPanel } from "./results-panel";

const emptyDownloadProgress = {
  active_label: "",
  active_subtitle: "",
  completed_items: 0,
  preflight_completed_items: 0,
  preflight_stage: "idle" as const,
  preflight_stage_label: "",
  preflight_total_items: 0,
  rejection_entries: [],
  running_workers: 0,
  swimlanes: [],
  total_items: 0,
  total_workers: 0,
  worker_progress: [],
  zip_part_completed_items: 0,
  zip_part_number: 0,
  zip_part_total_items: 0,
  zip_total_parts: 0,
  zip_completed: false
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
  it("shows conditional sidebar toggle labels", () => {
    const { rerender } = render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasSidebar
        hasQuery={false}
        groupBy="none"
        phase="idle"
        onDownload={vi.fn()}
        onToggleSidebar={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sidebarCollapsed={false}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getByRole("button", { name: "Hide Sidebar" })).toBeInTheDocument();

    rerender(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasSidebar
        hasQuery={false}
        groupBy="none"
        phase="idle"
        onDownload={vi.fn()}
        onToggleSidebar={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sidebarCollapsed
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getByRole("button", { name: "Show Sidebar" })).toBeInTheDocument();
  });

  it("renders filter controls above the search bar", () => {
    const { container } = render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="idle"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    const toolbar = container.querySelector(".ss-toolbar");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.firstElementChild).toHaveTextContent("Select");
    expect(toolbar?.lastElementChild).toHaveAttribute("name", "results-search");
  });

  it("surfaces total session counts separately from filtered results", () => {
    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={120000}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={emptyFetchProgress}
        hasQuery
        groupBy="none"
        phase="ready"
        onDownload={vi.fn()}
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

    expect(screen.getByRole("button", { name: /Build ZIP \(12 · 3.00 MB\)/i })).toBeInTheDocument();
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
        hasQuery
        groupBy="none"
        phase="ready"
        onDownload={vi.fn()}
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
        hasQuery={false}
        groupBy="creator"
        phase="ready"
        onDownload={vi.fn()}
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
    expect(screen.getAllByText("Second Creator")).toHaveLength(1);
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
        hasQuery={false}
        groupBy="creator"
        phase="ready"
        onDownload={vi.fn()}
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

  it("does not render an in-panel Stop Fetch button while fetching is active", () => {
    const activeFetchProgress = {
      ...emptyFetchProgress,
      running_jobs: 1,
      total_jobs: 1,
      job_progress: [
        {
          job_id: "character-account-appearances:ch_crystal",
          label: "Crystal Sparkle appearances",
          source: "characterAccountAppearances" as const,
          status: "running" as const,
          active_item_title: "Requesting page 1...",
          fetched_rows: 0,
          processed_batches: 0,
          expected_total_count: 100
        }
      ]
    };

    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={activeFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="fetching"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.queryByRole("button", { name: "Stop Fetch" })).not.toBeInTheDocument();
  });

  it("shows an ETA label while fetching", () => {
    const activeFetchProgress = {
      ...emptyFetchProgress,
      running_jobs: 1,
      total_jobs: 1,
      processed_batches: 8,
      job_progress: [
        {
          job_id: "side-character-appearances:ch_thursday",
          label: "Thursday appearances",
          source: "sideCharacter" as const,
          status: "running" as const,
          active_item_title: "Requesting side-character-feed-appearances page 9...",
          fetched_rows: 64,
          processed_batches: 8,
          expected_total_count: 160
        }
      ]
    };

    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={activeFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="fetching"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getByText(/left/i)).toBeInTheDocument();
  });

  it("shows a single fetch bar and separate overall completion percent", () => {
    const activeFetchProgress = {
      ...emptyFetchProgress,
      running_jobs: 1,
      total_jobs: 1,
      processed_batches: 17,
      job_progress: [
        {
          job_id: "side-character-appearances:ch_crystal",
          label: "Crystal Sparkle appearances",
          source: "sideCharacter" as const,
          status: "running" as const,
          active_item_title: "Requesting side-character-feed-appearances page 18...",
          fetched_rows: 136,
          processed_batches: 17,
          expected_total_count: 145205
        }
      ]
    };

    const { container } = render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={activeFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="fetching"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getAllByText(/overall$/i)).toHaveLength(1);
    expect(screen.queryByText("0/1 jobs")).not.toBeInTheDocument();
    expect(screen.getByText("Processing Batch 1 of 757 (Page 18/24)")).toBeInTheDocument();
    expect(screen.getByText("Page 18/18,151 (0.099%)")).toBeInTheDocument();
    expect(container.querySelectorAll(".ss-download-progress-fill")).toHaveLength(1);
    expect(container.querySelectorAll(".ss-download-worker-progress-track")).toHaveLength(0);
  });

  it("shows fetch active status text beneath the rotating headline", () => {
    const activeFetchProgress = {
      ...emptyFetchProgress,
      active_label: "Loading cached rows and checkpoints...",
      running_jobs: 1,
      total_jobs: 1,
      processed_batches: 1,
      job_progress: [
        {
          job_id: "character-account-appearances:ch_crystal",
          label: "Crystal Sparkle appearances",
          source: "characterAccountAppearances" as const,
          status: "running" as const,
          active_item_title: "Requesting side-character-feed-appearances page 1...",
          fetched_rows: 8,
          processed_batches: 1,
          expected_total_count: 145205
        }
      ]
    };

    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={activeFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="fetching"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getByText("Loading cached rows and checkpoints...")).toBeInTheDocument();
  });

  it("uses aggregate status and overall progress fill when multiple fetch jobs run in parallel", () => {
    const activeFetchProgress = {
      ...emptyFetchProgress,
      active_label: "This label should not win while multiple jobs run",
      running_jobs: 2,
      total_jobs: 2,
      processed_rows: 30,
      processed_batches: 4,
      job_progress: [
        {
          job_id: "creator-published:user_1",
          label: "Creator one published",
          source: "creatorPublished" as const,
          status: "running" as const,
          active_item_title: "Requesting creator-feed page 3...",
          fetched_rows: 20,
          processed_batches: 2,
          expected_total_count: 100
        },
        {
          job_id: "creator-cameos:user_1",
          label: "Creator one cameos",
          source: "creatorCameos" as const,
          status: "running" as const,
          active_item_title: "Requesting creator-cameos page 2...",
          fetched_rows: 10,
          processed_batches: 2,
          expected_total_count: 100
        }
      ]
    };

    const { container } = render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={activeFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="fetching"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getByText("Fetching 2 sources in parallel · 30 new rows")).toBeInTheDocument();
    expect(screen.queryByText(/Processing Batch/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Page \d+\//i)).not.toBeInTheDocument();

    const fill = container.querySelector(".ss-download-progress-fill") as HTMLElement | null;
    expect(fill).not.toBeNull();
    const widthPercent = Number.parseFloat(fill?.style.width ?? "0");
    expect(widthPercent).toBeCloseTo(15, 3);
  });

  it("keeps progress fill aligned with in-flight page while persisting", () => {
    const activeFetchProgress = {
      ...emptyFetchProgress,
      running_jobs: 1,
      total_jobs: 1,
      processed_batches: 433,
      job_progress: [
        {
          job_id: "side-character-appearances:ch_crystal",
          label: "Crystal Sparkle appearances",
          source: "sideCharacter" as const,
          status: "running" as const,
          active_item_title: "Persisting 8 rows...",
          fetched_rows: 3464,
          processed_batches: 433,
          expected_total_count: 145205
        }
      ]
    };

    const { container } = render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={0}
        downloadProgress={emptyDownloadProgress}
        fetchProgress={activeFetchProgress}
        hasQuery={false}
        groupBy="none"
        phase="fetching"
        onDownload={vi.fn()}
        onSelectionPresetChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onQueryChange={vi.fn()}
        onSetSelectedVideoIds={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query=""
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedBytes={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_newest"
        totalRowCount={0}
      />
    );

    expect(screen.getByText("Processing Batch 19 of 757 (Page 2/24)")).toBeInTheDocument();
    const fill = container.querySelector(".ss-download-progress-fill") as HTMLElement | null;
    expect(fill).not.toBeNull();
    const widthPercent = Number.parseFloat(fill?.style.width ?? "0");
    expect(widthPercent).toBeCloseTo((2 / 24) * 100, 3);
  });
});
