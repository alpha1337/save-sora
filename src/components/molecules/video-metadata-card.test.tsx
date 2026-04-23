import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoRow } from "types/domain";
import { useAppStore } from "@app/store/use-app-store";
import { VideoMetadataCard } from "./video-metadata-card";

const baseRow: VideoRow = {
  row_id: "row-1",
  video_id: "s_123",
  source_type: "profile",
  source_bucket: "published",
  title: "Auto title should not display",
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
  published_at: "2026-04-21T12:00:00.000Z",
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
  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useAppStore.setState({ download_history_ids: [] });
    });
  });

  it("uses video id as the default card title", () => {
    const { container } = render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={baseRow}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(screen.getByText("s_123")).toBeInTheDocument();
    expect(screen.queryByText("creator")).not.toBeInTheDocument();
    expect(screen.getByText("04/21/2026")).toBeInTheDocument();
    expect(container.querySelector(".ss-results-card-filesize")).toBeNull();
    expect(screen.queryByText("Discovery title")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto title should not display")).not.toBeInTheDocument();
  });

  it("does not render creator handles in the card summary section", () => {
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

    expect(screen.queryByText("Creator")).not.toBeInTheDocument();
    expect(screen.queryByText("creator")).not.toBeInTheDocument();
    expect(screen.getByText("04/21/2026")).toBeInTheDocument();
  });

  it("shows relative posted timestamps using the expected thresholds", () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-22T12:00:00.000Z");
    vi.setSystemTime(now);

    const scenarios = [
      { postedAt: "2026-04-22T11:59:40.000Z", expected: "Just now" },
      { postedAt: "2026-04-22T11:50:00.000Z", expected: "10 minutes ago" },
      { postedAt: "2026-04-22T09:00:00.000Z", expected: "3 hours ago" },
      { postedAt: "2026-04-20T12:00:00.000Z", expected: "2 days ago" },
      { postedAt: "2026-04-01T12:00:00.000Z", expected: "3 weeks ago" },
      { postedAt: "2026-01-22T12:00:00.000Z", expected: "3 months ago" }
    ];

    for (const scenario of scenarios) {
      const { unmount } = render(
        <VideoMetadataCard
          onPreviewToggle={vi.fn()}
          onToggleSelectedVideoId={vi.fn()}
          previewActive={false}
          row={{ ...baseRow, published_at: scenario.postedAt }}
          selected={false}
          skipReasonLabel=""
        />
      );

      expect(screen.getByText(scenario.expected)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows a Draft badge when a draft row still uses a gen_* id", () => {
    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          source_type: "drafts",
          source_bucket: "drafts",
          video_id: "gen_alpha123"
        }}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });

  it("shows a Shared badge when a draft row has a shared s_* id", () => {
    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          source_type: "characterAccountDrafts",
          source_bucket: "character-account",
          video_id: "s_shared123"
        }}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("shows Shared/Draft metadata in video details for draft rows", () => {
    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          source_type: "drafts",
          source_bucket: "drafts",
          video_id: "gen_alpha123"
        }}
        selected={false}
        skipReasonLabel=""
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    const detailMetaList = document.querySelector(".ss-results-card-meta--overlay");
    expect(detailMetaList).not.toBeNull();
    const sharedRow = within(detailMetaList as HTMLElement).getByText("Shared").closest("div");
    const draftRow = within(detailMetaList as HTMLElement).getByText("Draft").closest("div");
    expect(sharedRow).not.toBeNull();
    expect(draftRow).not.toBeNull();
    expect(sharedRow?.querySelector("dd")?.textContent).toBe("No");
    expect(draftRow?.querySelector("dd")?.textContent).toBe("Yes");
  });

  it("replaces Draft with Downloaded when a draft gen_* id exists in download history", () => {
    act(() => {
      useAppStore.setState({ download_history_ids: ["gen_alpha123"] });
    });

    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          source_type: "drafts",
          source_bucket: "drafts",
          video_id: "gen_alpha123"
        }}
        selected={false}
        skipReasonLabel=""
      />
    );

    expect(screen.getByText("Downloaded")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("renders duration in bottom-left and keeps remixes/likes/views in bottom-right stack order", () => {
    const { container } = render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={{
          ...baseRow,
          duration_seconds: 14,
          remix_count: 7,
          like_count: 3,
          view_count: 123,
          thumbnail_url: "https://example.com/thumb.jpg"
        }}
        selected={false}
        skipReasonLabel=""
      />
    );

    const durationNode = container.querySelector(".ss-results-thumb-duration .ss-results-thumb-stat");
    expect(durationNode?.textContent?.trim()).toBe("0:14");

    const stackNodes = [...container.querySelectorAll(".ss-results-thumb-stats .ss-results-thumb-stat")].map((node) =>
      node.textContent?.trim()
    );
    expect(stackNodes).toEqual(["7", "3", "123"]);
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

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(screen.getByText("File Size")).toBeInTheDocument();
    expect(screen.getByText("Calculating...")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Play preview" })).toBeInTheDocument();

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
    expect(screen.getByRole("button", { name: "Pause preview" })).toBeInTheDocument();
  });

  it("uses gif_url when raw payload is stripped", () => {
    const gifUrl = "https://videos.openai.com/az/files/strip-safe-gif/raw";
    const rowWithGifUrl = {
      ...baseRow,
      gif_url: gifUrl,
      thumbnail_url: "https://example.com/thumb.jpg",
      raw_payload_json: ""
    };

    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={rowWithGifUrl}
        selected={false}
        skipReasonLabel=""
      />
    );

    const thumbnail = screen.getByRole("img");
    expect(thumbnail).toHaveClass("ss-results-card-thumb--gif");
    expect((thumbnail as HTMLImageElement).src).toContain(gifUrl);
  });

  it("does not use gif encoding path from items payload", () => {
    const gifUrl = "https://videos.openai.com/az/files/hover-gif/raw";
    const rowWithHoverGif = {
      ...baseRow,
      thumbnail_url: "https://example.com/thumb.jpg",
      raw_payload_json: JSON.stringify({
        items: [
          {
            post: {
              attachments: [
                {
                  encodings: {
                    gif: {
                      path: gifUrl
                    }
                  }
                }
              ]
            }
          }
        ]
      })
    };

    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={rowWithHoverGif}
        selected={false}
        skipReasonLabel=""
      />
    );

    const thumbnail = screen.getByRole("img");
    expect(thumbnail).toHaveClass("ss-results-card-thumb--image");
    expect(thumbnail.getAttribute("style")).toContain("thumb.jpg");
  });

  it("uses gif encoding path by default from top-level post attachment", () => {
    const gifUrl = "https://videos.openai.com/az/files/post-level-gif/raw";
    const rowWithTopLevelPostGif = {
      ...baseRow,
      thumbnail_url: "https://example.com/thumb.jpg",
      raw_payload_json: JSON.stringify({
        post: {
          attachments: [
            {
              encodings: {
                gif: {
                  path: gifUrl
                }
              }
            }
          ]
        }
      })
    };

    render(
      <VideoMetadataCard
        onPreviewToggle={vi.fn()}
        onToggleSelectedVideoId={vi.fn()}
        previewActive={false}
        row={rowWithTopLevelPostGif}
        selected={false}
        skipReasonLabel=""
      />
    );

    const thumbnail = screen.getByRole("img");
    expect(thumbnail).toHaveClass("ss-results-card-thumb--gif");
    expect((thumbnail as HTMLImageElement).src).toContain(gifUrl);
  });

  it("opens and closes full-card details takeover from the three-dot button", () => {
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

    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Caption")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByText("Prompt text")).toBeInTheDocument();
    expect(screen.getByText("Caption")).toBeInTheDocument();
    expect(screen.getByText("Caption text")).toBeInTheDocument();
    expect(screen.getByText("File Size")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    const sharedMetaRow = screen.getByText("Shared").closest("div");
    const draftMetaRow = screen.getByText("Draft").closest("div");
    expect(sharedMetaRow?.querySelector("dd")?.textContent).toBe("Yes");
    expect(draftMetaRow?.querySelector("dd")?.textContent).toBe("No");
    expect(screen.queryByText("Source")).not.toBeInTheDocument();
    expect(screen.queryByText("Duration")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Caption")).not.toBeInTheDocument();
  });

  it("toggles selection on card click but not on details/actions", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(onToggleSelectedVideoId).toHaveBeenCalledTimes(1);

    const overlayActions = document.querySelector(".ss-results-card-overlay .ss-results-media-actions");
    expect(overlayActions?.querySelectorAll("button").length).toBe(0);
    expect(overlayActions?.querySelectorAll("a").length).toBe(1);

    fireEvent.click(screen.getByRole("link", { name: "Open in Sora" }));
    expect(onToggleSelectedVideoId).toHaveBeenCalledTimes(1);
  });
});
