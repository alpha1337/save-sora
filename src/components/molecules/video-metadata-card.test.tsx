import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoRow } from "types/domain";
import { VideoMetadataCard } from "./video-metadata-card";

const baseRow: VideoRow = {
  row_id: "row-1",
  video_id: "s_123",
  source_type: "profile",
  source_bucket: "published",
  title: "",
  prompt: "Prompt text",
  discovery_phrase: "Discovery title",
  description: "Description text",
  caption: "Caption text",
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

describe("VideoMetadataCard", () => {
  it("uses discovery phrase as the first title fallback and hides raw video id + downloadable badge", () => {
    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={baseRow}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(screen.getByText("Discovery title")).toBeInTheDocument();
    expect(screen.queryByText("s_123")).not.toBeInTheDocument();
    expect(screen.queryByText("downloadable")).not.toBeInTheDocument();
  });

  it("shows file size in card metadata and keeps duration in thumbnail stats instead of card body", () => {
    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{ ...baseRow, estimated_size_bytes: 1024 * 1024 * 5, duration_seconds: 14, view_count: 333 }}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(screen.getByText("File Size")).toBeInTheDocument();
    expect(screen.getByText("5.00 MB")).toBeInTheDocument();
    expect(screen.queryByText("Duration")).not.toBeInTheDocument();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
  });

  it("shows calculating file size for unresolved draft rows", () => {
    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          source_bucket: "drafts",
          video_id: "",
          is_downloadable: false,
          skip_reason: "unresolved_draft_video_id",
          estimated_size_bytes: null
        }}
        selected={false}
        skipReasonLabel="Draft not published/shared yet"
      />
    );

    expect(screen.getByText("File Size")).toBeInTheDocument();
    expect(screen.getByText("Calculating...")).toBeInTheDocument();
  });

  it("hides zero or null stats from thumbnail and metadata", () => {
    const { container } = render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          source_type: "",
          creator_name: "",
          character_name: "",
          character_names: [],
          published_at: null,
          duration_seconds: 0,
          view_count: 0,
          like_count: null,
          remix_count: 0,
          estimated_size_bytes: null
        }}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(container.querySelectorAll(".ss-results-thumb-stat")).toHaveLength(0);
    expect(screen.queryByText("File Size")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByText("-")).not.toBeInTheDocument();
  });

  it("renders video only for active preview state", () => {
    const activeRow = {
      ...baseRow,
      thumbnail_url: "https://example.com/thumb.jpg",
      playback_url: "https://example.com/video.mp4"
    };
    const { rerender } = render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={activeRow}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("img")).toBeInTheDocument();

    rerender(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive
        row={activeRow}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(document.querySelector("video")).not.toBeNull();
  });

  it("toggles selection when clicking card surface but not action controls", () => {
    const onToggleSelectedVideoId = vi.fn();
    const onPreviewToggle = vi.fn();

    const { container } = render(
      <VideoMetadataCard
        onPreviewToggle={onPreviewToggle}
        onToggleSelectedVideoId={onToggleSelectedVideoId}
        previewActive={false}
        row={{ ...baseRow, playback_url: "https://example.com/video.mp4", detail_url: "https://sora.chatgpt.com/p/s_123" }}
        selected={false}
        skipReasonLabel=""
      />
    );

    const article = container.querySelector(".ss-results-card");
    expect(article).not.toBeNull();
    if (article) {
      fireEvent.click(article);
    }
    expect(onToggleSelectedVideoId).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Play preview" }));
    expect(onPreviewToggle).toHaveBeenCalledTimes(1);
    expect(onToggleSelectedVideoId).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("link", { name: "Open in Sora" }));
    expect(onToggleSelectedVideoId).toHaveBeenCalledTimes(1);
  });
});
