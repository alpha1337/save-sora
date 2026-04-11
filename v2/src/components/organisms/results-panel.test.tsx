import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoRow } from "types/domain";
import { ResultsPanel } from "./results-panel";

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
  duration_seconds: null,
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
        hasRows
        hasQuery
        nonDownloadableRowCount={4000}
        onDownload={vi.fn()}
        onExportCsv={vi.fn()}
        onQueryChange={vi.fn()}
        onSelectAllToggle={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query="alpha"
        rows={[baseRow]}
        selectableRowCount={1}
        selectedDownloadableRowCount={12}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_at"
        totalRowCount={124000}
      />
    );

    expect(screen.getByText("124,000 rows in session · 1 visible after search")).toBeInTheDocument();
    expect(screen.getByText("Search only changes what is visible here. It does not remove fetched rows from the local session.")).toBeInTheDocument();
    expect(screen.getByText("Not ZIP-Ready")).toBeInTheDocument();
    expect(screen.getByText("120,000")).toBeInTheDocument();
    expect(screen.getByText("4,000")).toBeInTheDocument();
  });

  it("explains when search hides rows already fetched into the session", () => {
    render(
      <ResultsPanel
        allVisibleSelected={false}
        downloadableRowCount={120000}
        hasRows
        hasQuery
        nonDownloadableRowCount={4000}
        onDownload={vi.fn()}
        onExportCsv={vi.fn()}
        onQueryChange={vi.fn()}
        onSelectAllToggle={vi.fn()}
        onSortKeyChange={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        query="missing"
        rows={[]}
        selectableRowCount={0}
        selectedDownloadableRowCount={0}
        selectedVideoIds={[]}
        selectedVisibleRowCount={0}
        sortKey="published_at"
        totalRowCount={124000}
      />
    );

    expect(screen.getByText("No rows match your search.")).toBeInTheDocument();
    expect(screen.getByText("Clear or change the search text to see the other 124,000 rows already stored in this session.")).toBeInTheDocument();
  });
});
