import { describe, expect, it, vi } from "vitest";
import type { DownloadHistoryRecord, DownloadQueueItem, VideoRow } from "types/domain";
import { runDownloadPreflight } from "./download-preflight";

function createRow(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    row_id: "drafts:gen_alpha",
    video_id: "gen_alpha",
    source_type: "drafts",
    source_bucket: "drafts",
    title: "Alpha Draft",
    prompt: "",
    discovery_phrase: "",
    description: "",
    caption: "",
    creator_name: "Creator",
    creator_username: "creator",
    character_name: "",
    character_username: "",
    character_names: [],
    category_tags: ["drafts"],
    created_at: null,
    published_at: null,
    like_count: null,
    view_count: null,
    share_count: null,
    repost_count: null,
    remix_count: null,
    detail_url: "",
    thumbnail_url: "",
    playback_url: "https://videos.openai.com/watermark-alpha.mp4",
    download_url: "https://videos.openai.com/watermark-alpha.mp4",
    duration_seconds: null,
    estimated_size_bytes: null,
    width: null,
    height: null,
    raw_payload_json: "{}",
    is_downloadable: true,
    skip_reason: "",
    fetched_at: "2026-04-23T00:00:00.000Z",
    ...overrides
  };
}

function createPersistence() {
  let queue: DownloadQueueItem[] = [];
  const listDownloadHistoryRecords = vi.fn((): Promise<DownloadHistoryRecord[]> => Promise.resolve([]));
  const replaceQueue = vi.fn((items: DownloadQueueItem[]) => {
    queue = items;
    return Promise.resolve(queue);
  });
  const patchQueue = vi.fn((patches: Array<{ current_id: string; id?: string; no_watermark?: string | null; watermark?: string }>) => {
    queue = queue.map((entry) => {
      const patch = patches.find((candidate) => candidate.current_id === entry.id);
      if (!patch) {
        return entry;
      }
      return {
        id: patch.id ?? entry.id,
        watermark: patch.watermark ?? entry.watermark,
        no_watermark: patch.no_watermark === undefined ? entry.no_watermark : patch.no_watermark
      };
    });
    return Promise.resolve(queue);
  });
  return { listDownloadHistoryRecords, patchQueue, replaceQueue };
}

function sleepNow(): Promise<void> {
  return Promise.resolve();
}

describe("download preflight", () => {
  it("updates gen_* rows to s_* ids when draft sharing succeeds", async () => {
    const persistence = createPersistence();
    const result = await runDownloadPreflight([createRow()], {
      ...persistence,
      removeWatermark: vi.fn(),
      resolveDraftRow: vi.fn((row: VideoRow): Promise<VideoRow> => Promise.resolve({
        ...row,
        video_id: "s_alpha",
        playback_url: "https://videos.openai.com/watermark-alpha-shared.mp4",
        download_url: "https://videos.openai.com/no-watermark-alpha.mp4"
      })),
      sleep: sleepNow
    });

    expect(result.queue).toEqual([
      {
        id: "s_alpha",
        watermark: "https://videos.openai.com/watermark-alpha-shared.mp4",
        no_watermark: "https://videos.openai.com/no-watermark-alpha.mp4"
      }
    ]);
    expect(result.selected_id_remap.get("gen_alpha")).toBe("s_alpha");
    expect(result.rows[0]?.video_id).toBe("s_alpha");
  });

  it("keeps watermark fallback and logs could_not_share_video when draft sharing fails", async () => {
    const persistence = createPersistence();
    const result = await runDownloadPreflight([
      createRow({
        download_url: "https://videos.openai.com/no-watermark-alpha.mp4",
        raw_payload_json: JSON.stringify({
          download_urls: {
            watermark: "https://videos.openai.com/watermark-alpha.mp4",
            no_watermark: "https://videos.openai.com/no-watermark-alpha.mp4"
          }
        })
      })
    ], {
      ...persistence,
      removeWatermark: vi.fn(),
      resolveDraftRow: vi.fn((): Promise<null> => Promise.resolve(null)),
      sleep: sleepNow
    });

    expect(result.queue[0]).toEqual({
      id: "gen_alpha",
      watermark: "https://videos.openai.com/watermark-alpha.mp4",
      no_watermark: null
    });
    expect(result.rejections).toEqual([
      {
        id: "gen_alpha",
        title: "Alpha Draft",
        reason: "could_not_share_video"
      }
    ]);
  });

  it("continues through the batch when a draft share attempt throws", async () => {
    const persistence = createPersistence();
    const resolveDraftRow = vi.fn((row: VideoRow): Promise<VideoRow | null> => {
      if (row.video_id === "gen_throws") {
        return Promise.reject(new Error("share failed"));
      }
      return Promise.resolve({
        ...row,
        video_id: "s_after_throw",
        playback_url: "https://videos.openai.com/watermark-after-throw.mp4",
        download_url: "https://videos.openai.com/no-watermark-after-throw.mp4"
      });
    });
    const result = await runDownloadPreflight([
      createRow({
        row_id: "drafts:gen_throws",
        video_id: "gen_throws",
        title: "Throws"
      }),
      createRow({
        row_id: "drafts:gen_after_throw",
        video_id: "gen_after_throw",
        title: "After Throw"
      })
    ], {
      ...persistence,
      removeWatermark: vi.fn(),
      resolveDraftRow,
      sleep: sleepNow
    });

    expect(result.queue).toEqual([
      {
        id: "gen_throws",
        watermark: "https://videos.openai.com/watermark-alpha.mp4",
        no_watermark: null
      },
      {
        id: "s_after_throw",
        watermark: "https://videos.openai.com/watermark-after-throw.mp4",
        no_watermark: "https://videos.openai.com/no-watermark-after-throw.mp4"
      }
    ]);
    expect(result.rejections).toEqual([
      {
        id: "gen_throws",
        title: "Throws",
        reason: "could_not_share_video"
      }
    ]);
  });

  it("bypasses the utility when an existing no-watermark URL is available", async () => {
    const persistence = createPersistence();
    const removeWatermark = vi.fn();
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_existing",
        video_id: "s_existing",
        source_type: "profile",
        source_bucket: "published",
        title: "Existing Source",
        playback_url: "https://videos.openai.com/watermark-existing.mp4",
        download_url: "https://videos.openai.com/no-watermark-existing.mp4"
      })
    ], {
      ...persistence,
      removeWatermark,
      resolveDraftRow: vi.fn(),
      sleep: sleepNow
    });

    expect(removeWatermark).not.toHaveBeenCalled();
    expect(result.queue[0]?.no_watermark).toBe("https://videos.openai.com/no-watermark-existing.mp4");
    expect(result.rejections).toEqual([]);
  });

  it("bypasses the utility when download history has a no-watermark URL", async () => {
    const persistence = createPersistence();
    persistence.listDownloadHistoryRecords.mockResolvedValue([
      {
        video_id: "s_history",
        no_watermark: "https://videos.openai.com/no-watermark-history.mp4",
        watermark_removal_failed_at: null
      }
    ]);
    const removeWatermark = vi.fn();
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_history",
        video_id: "s_history",
        source_type: "profile",
        source_bucket: "published",
        title: "History Source"
      })
    ], {
      ...persistence,
      removeWatermark,
      resolveDraftRow: vi.fn(),
      sleep: sleepNow
    });

    expect(removeWatermark).not.toHaveBeenCalled();
    expect(result.queue[0]?.no_watermark).toBe("https://videos.openai.com/no-watermark-history.mp4");
    expect(result.rows[0]?.download_url).toBe("https://videos.openai.com/no-watermark-history.mp4");
    expect(result.rejections).toEqual([]);
  });

  it("patches no_watermark when the utility succeeds", async () => {
    const persistence = createPersistence();
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_needs_utility",
        video_id: "s_needs_utility",
        source_type: "profile",
        source_bucket: "published",
        title: "Needs Utility"
      })
    ], {
      ...persistence,
      removeWatermark: vi.fn(() => Promise.resolve("https://videos.openai.com/no-watermark-utility.mp4")),
      resolveDraftRow: vi.fn(),
      sleep: sleepNow
    });

    expect(result.queue[0]).toEqual({
      id: "s_needs_utility",
      watermark: "https://videos.openai.com/watermark-alpha.mp4",
      no_watermark: "https://videos.openai.com/no-watermark-utility.mp4"
    });
    expect(persistence.patchQueue).toHaveBeenCalledWith([
      {
        current_id: "s_needs_utility",
        no_watermark: "https://videos.openai.com/no-watermark-utility.mp4"
      }
    ]);
  });

  it("skips previously failed watermark removals when retry is disabled", async () => {
    const persistence = createPersistence();
    persistence.listDownloadHistoryRecords.mockResolvedValue([
      {
        video_id: "s_previously_failed",
        no_watermark: null,
        watermark_removal_failed_at: "2026-04-24T00:00:00.000Z"
      }
    ]);
    const removeWatermark = vi.fn(() => Promise.resolve("https://videos.openai.com/no-watermark-should-not-run.mp4"));
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_previously_failed",
        video_id: "s_previously_failed",
        source_type: "profile",
        source_bucket: "published",
        title: "Previously Failed"
      })
    ], {
      ...persistence,
      removeWatermark,
      resolveDraftRow: vi.fn(),
      sleep: sleepNow
    });

    expect(removeWatermark).not.toHaveBeenCalled();
    expect(result.queue[0]).toEqual({
      id: "s_previously_failed",
      watermark: "https://videos.openai.com/watermark-alpha.mp4",
      no_watermark: null
    });
    expect(result.rejections).toEqual([
      {
        id: "s_previously_failed",
        title: "Previously Failed",
        reason: "access_restricted"
      }
    ]);
  });

  it("continues shared source resolution after a previously failed watermark skip", async () => {
    const persistence = createPersistence();
    persistence.listDownloadHistoryRecords.mockResolvedValue([
      {
        video_id: "s_previously_failed",
        no_watermark: null,
        watermark_removal_failed_at: "2026-04-24T00:00:00.000Z"
      }
    ]);
    const removeWatermark = vi.fn(() => Promise.resolve("https://videos.openai.com/no-watermark-next.mp4"));
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_previously_failed",
        video_id: "s_previously_failed",
        source_type: "profile",
        source_bucket: "published",
        title: "Previously Failed"
      }),
      createRow({
        row_id: "profile:s_next",
        video_id: "s_next",
        source_type: "profile",
        source_bucket: "published",
        title: "Next Video"
      })
    ], {
      ...persistence,
      removeWatermark,
      resolveDraftRow: vi.fn(),
      sleep: sleepNow
    });

    expect(removeWatermark).toHaveBeenCalledTimes(1);
    expect(removeWatermark).toHaveBeenCalledWith("s_next");
    expect(result.queue).toEqual([
      {
        id: "s_previously_failed",
        watermark: "https://videos.openai.com/watermark-alpha.mp4",
        no_watermark: null
      },
      {
        id: "s_next",
        watermark: "https://videos.openai.com/watermark-alpha.mp4",
        no_watermark: "https://videos.openai.com/no-watermark-next.mp4"
      }
    ]);
    expect(result.rejections).toEqual([
      {
        id: "s_previously_failed",
        title: "Previously Failed",
        reason: "access_restricted"
      }
    ]);
  });

  it("retries previously failed watermark removals when retry is enabled", async () => {
    const persistence = createPersistence();
    persistence.listDownloadHistoryRecords.mockResolvedValue([
      {
        video_id: "s_retry_failed",
        no_watermark: null,
        watermark_removal_failed_at: "2026-04-24T00:00:00.000Z"
      }
    ]);
    const removeWatermark = vi.fn(() => Promise.resolve("https://videos.openai.com/no-watermark-retry.mp4"));
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_retry_failed",
        video_id: "s_retry_failed",
        source_type: "profile",
        source_bucket: "published",
        title: "Retry Failed"
      })
    ], {
      ...persistence,
      removeWatermark,
      resolveDraftRow: vi.fn(),
      retryPreviouslyFailedWatermarkRemovals: true,
      sleep: sleepNow
    });

    expect(removeWatermark).toHaveBeenCalledWith("s_retry_failed");
    expect(result.queue[0]?.no_watermark).toBe("https://videos.openai.com/no-watermark-retry.mp4");
    expect(result.rejections).toEqual([]);
  });

  it("falls back to watermark and logs access_restricted when utility returns null", async () => {
    const persistence = createPersistence();
    const result = await runDownloadPreflight([
      createRow({
        row_id: "profile:s_restricted",
        video_id: "s_restricted",
        source_type: "profile",
        source_bucket: "published",
        title: "Restricted"
      })
    ], {
      ...persistence,
      removeWatermark: vi.fn((): Promise<null> => Promise.resolve(null)),
      resolveDraftRow: vi.fn(),
      sleep: sleepNow
    });

    expect(result.queue[0]).toEqual({
      id: "s_restricted",
      watermark: "https://videos.openai.com/watermark-alpha.mp4",
      no_watermark: null
    });
    expect(result.rejections).toEqual([
      {
        id: "s_restricted",
        title: "Restricted",
        reason: "access_restricted"
      }
    ]);
  });

  it("uses an existing draft post id without calling the draft resolver", async () => {
    const persistence = createPersistence();
    const resolveDraftRow = vi.fn();
    const result = await runDownloadPreflight([
      createRow({
        raw_payload_json: JSON.stringify({
          post: {
            post: {
              id: "s_from_post"
            }
          }
        })
      })
    ], {
      ...persistence,
      removeWatermark: vi.fn((): Promise<null> => Promise.resolve(null)),
      resolveDraftRow,
      sleep: sleepNow
    });

    expect(resolveDraftRow).not.toHaveBeenCalled();
    expect(result.queue[0]?.id).toBe("s_from_post");
    expect(result.rejections[0]?.reason).toBe("access_restricted");
  });
});
