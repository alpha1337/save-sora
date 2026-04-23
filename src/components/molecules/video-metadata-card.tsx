import { useEffect, useState, type MouseEvent, type ReactElement } from "react";
import { Clock3, ExternalLink, Eye, Heart, MoreHorizontal, Pause, Play, Repeat2, X } from "lucide-react";
import type { VideoRow } from "types/domain";
import { Badge } from "@components/atoms/badge";
import { Checkbox } from "@components/atoms/checkbox";
import { useAppStore } from "@app/store/use-app-store";
import { formatBytes, formatCount, formatDuration } from "@lib/utils/format-utils";
import { resolveHoverGifUrl, resolvePreviewPlaybackUrl } from "@lib/utils/video-playback";

interface VideoMetadataCardProps {
  row: VideoRow;
  selected: boolean;
  previewActive: boolean;
  skipReasonLabel: string;
  onPreviewToggle: (rowId: string) => void;
  onToggleSelectedVideoId: (videoId: string) => void;
}

/**
 * Simplified card with expandable details takeover.
 */
export function VideoMetadataCard({
  onPreviewToggle,
  onToggleSelectedVideoId,
  previewActive,
  row,
  selected,
  skipReasonLabel
}: VideoMetadataCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [gifLoadFailed, setGifLoadFailed] = useState(false);
  const isDownloaded = useAppStore((state) => Boolean(row.video_id && state.download_history_ids.includes(row.video_id)));

  const canSelect = Boolean(row.is_downloadable && row.video_id);
  const previewUrl = resolvePreviewPlaybackUrl(row);
  const gifThumbnailUrl = resolveHoverGifUrl(row);
  const canPlay = Boolean(previewUrl);
  const playableGifThumbnailUrl = !gifLoadFailed ? gifThumbnailUrl : "";
  const activeThumbnailUrl = row.thumbnail_url;
  const characterLine = row.character_names.join(", ") || row.character_name || "";
  const cardTitle = resolveCardTitle(row);
  const primaryStatusBadge = resolvePrimaryStatusBadge(row, isDownloaded);
  const summaryDate = formatShortDate(row.published_at);
  const relativePostedTime = formatRelativePostedTime(row.published_at);
  const fileSizeLabel = resolveFileSizeLabel(row);
  const detailNarrativeBlocks = resolveNarrativeBlocks(row);
  const detailMetaBlocks = [
    { label: "File Size", value: fileSizeLabel || "-" },
    ...(characterLine ? [{ label: "Character", value: characterLine }] : [])
  ];
  const durationThumbStat =
    row.duration_seconds && row.duration_seconds > 0
      ? { icon: <Clock3 aria-hidden="true" size={12} />, value: formatDuration(row.duration_seconds) }
      : null;
  const visibleThumbStats = [
    row.remix_count && row.remix_count > 0
      ? { icon: <Repeat2 aria-hidden="true" size={12} />, value: formatCount(row.remix_count) }
      : null,
    row.like_count && row.like_count > 0
      ? { icon: <Heart aria-hidden="true" size={12} />, value: formatCount(row.like_count) }
      : null,
    row.view_count && row.view_count > 0
      ? { icon: <Eye aria-hidden="true" size={12} />, value: formatCount(row.view_count) }
      : null
  ].filter((entry): entry is { icon: ReactElement; value: string } => Boolean(entry));
  const hasOverlayDetails = detailNarrativeBlocks.length > 0 || detailMetaBlocks.length > 0;
  const cardClasses = `ss-results-card${canSelect ? " is-selectable" : ""}${selected ? " is-selected" : ""}${detailsOpen ? " is-details-open" : ""}`;

  useEffect(() => {
    setGifLoadFailed(false);
  }, [row.row_id, gifThumbnailUrl]);

  function handleCardClick(event: MouseEvent<HTMLElement>): void {
    if (!canSelect || shouldIgnoreCardToggle(event.target)) {
      return;
    }

    onToggleSelectedVideoId(row.video_id);
  }

  return (
    <article className={cardClasses} onClick={handleCardClick}>
      <div className="ss-results-media-shell">
        <div className="ss-results-thumb-shell">
          <div className="ss-results-card-selection">
            <Checkbox
              checked={selected}
              disabled={!canSelect}
              id={`row-${row.row_id}`}
              label=""
              ariaLabel={`Select ${cardTitle}`}
              onCheckedChange={() => onToggleSelectedVideoId(row.video_id)}
            />
          </div>
          <button
            aria-label="Open details"
            className="ss-results-card-menu-button"
            data-no-card-toggle="true"
            onClick={() => setDetailsOpen(true)}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={16} />
          </button>
          {primaryStatusBadge ? (
            <div className="ss-results-thumb-status">
              <Badge tone={primaryStatusBadge.tone}>{primaryStatusBadge.label}</Badge>
            </div>
          ) : null}
          {previewActive && canPlay ? (
            <video
              autoPlay
              className="ss-results-card-thumb"
              playsInline
              poster={row.thumbnail_url || undefined}
              preload="metadata"
              src={previewUrl}
            />
          ) : playableGifThumbnailUrl ? (
            <img
              alt={cardTitle}
              className="ss-results-card-thumb ss-results-card-thumb--gif"
              loading="lazy"
              onError={() => setGifLoadFailed(true)}
              src={playableGifThumbnailUrl}
            />
          ) : activeThumbnailUrl ? (
            <div
              aria-label={cardTitle}
              className="ss-results-card-thumb ss-results-card-thumb--image"
              role="img"
              style={{ backgroundImage: `url("${activeThumbnailUrl}")` }}
            />
          ) : (
            <div className="ss-results-card-thumb ss-results-card-thumb--empty">No preview</div>
          )}
          {durationThumbStat ? (
            <div className="ss-results-thumb-duration">
              <span className="ss-results-thumb-stat">
                {durationThumbStat.icon}
                {durationThumbStat.value}
              </span>
            </div>
          ) : null}
          {visibleThumbStats.length > 0 ? (
            <div className="ss-results-thumb-stats">
              {visibleThumbStats.map((entry, index) => (
                <span className="ss-results-thumb-stat" key={`${entry.value}-${index}`}>
                  {entry.icon}
                  {entry.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="ss-results-card-body">
        <button
          aria-label={previewActive ? "Pause preview" : "Play preview"}
          className="ss-results-card-play-button"
          data-no-card-toggle="true"
          disabled={!canPlay}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPreviewToggle(row.row_id);
          }}
          type="button"
        >
          {previewActive ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        </button>
        <div className="ss-results-card-body-main">
          <strong className="ss-results-card-title">{cardTitle}</strong>
          <div className="ss-results-card-meta-row ss-results-card-meta-row--stacked">
            <span className="ss-results-card-date">{summaryDate || "-"}</span>
            <span className="ss-results-card-relative-time">{relativePostedTime}</span>
          </div>
          {!row.is_downloadable && skipReasonLabel ? <div className="ss-results-card-subtitle">{skipReasonLabel}</div> : null}
        </div>
      </div>

      {detailsOpen ? (
        <div className="ss-results-card-overlay" data-no-card-toggle="true">
          <div className="ss-results-card-overlay-head">
            <strong className="ss-results-card-overlay-title">Video details</strong>
            <button
              aria-label="Close details"
              className="ss-results-card-overlay-close"
              data-no-card-toggle="true"
              onClick={() => setDetailsOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>

          <div className="ss-results-card-overlay-scroll">
            {detailNarrativeBlocks.map((detailBlock) => (
              <section className="ss-results-card-overlay-text" key={detailBlock.label}>
                <h4>{detailBlock.label}</h4>
                <p>{detailBlock.value}</p>
              </section>
            ))}
            {detailMetaBlocks.length > 0 ? (
              <dl className="ss-results-card-meta ss-results-card-meta--overlay">
                {detailMetaBlocks.map((detailMetaBlock) => (
                  <div key={detailMetaBlock.label}>
                    <dt>{detailMetaBlock.label}</dt>
                    <dd>{detailMetaBlock.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {!hasOverlayDetails ? <p className="ss-results-card-overlay-empty">No prompt, caption, or character metadata.</p> : null}
          </div>

          <div className="ss-results-media-actions">
            {row.detail_url ? (
              <a className="ss-media-action-link ss-media-action-link--open" href={row.detail_url} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" />
                Open in Sora
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function shouldIgnoreCardToggle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "a,button,input,select,textarea,[role=\"button\"],[role=\"checkbox\"],label,.ss-checkbox-row,[data-no-card-toggle=\"true\"]"
    )
  );
}

function resolveCardTitle(row: VideoRow): string {
  const videoId = row.video_id?.trim();
  if (videoId) {
    return videoId;
  }
  const rowId = row.row_id?.trim();
  if (rowId) {
    return rowId;
  }
  return "video";
}

function resolveFileSizeLabel(row: VideoRow): string {
  if (row.source_bucket === "drafts" && (!row.video_id || row.skip_reason === "unresolved_draft_video_id")) {
    return "Calculating...";
  }

  return formatBytes(row.estimated_size_bytes);
}

function resolveNarrativeBlocks(row: VideoRow): Array<{ label: "Caption" | "Prompt"; value: string }> {
  const sections: Array<{ label: "Caption" | "Prompt"; value: string }> = [];
  const caption = (row.caption || "").trim();
  if (caption) {
    sections.push({ label: "Caption", value: caption });
  }

  const prompt = (row.prompt || "").trim();
  if (prompt) {
    sections.push({ label: "Prompt", value: prompt });
  }

  return sections;
}

function resolvePrimaryStatusBadge(
  row: VideoRow,
  isDownloaded: boolean
): { label: "Draft" | "Shared" | "Downloaded"; tone: "warning" | "success" } | null {
  if (isDownloaded) {
    return { label: "Downloaded", tone: "success" };
  }

  if (!isDraftLikeSource(row.source_type)) {
    return null;
  }

  if (/^s_[A-Za-z0-9_-]+$/.test(row.video_id)) {
    return { label: "Shared", tone: "success" };
  }
  if (/^gen_[A-Za-z0-9_-]+$/.test(row.video_id)) {
    return { label: "Draft", tone: "warning" };
  }

  return null;
}

function isDraftLikeSource(source: string): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

function formatShortDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const year = String(parsed.getFullYear());
  return `${month}/${day}/${year}`;
}

function formatRelativePostedTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return "-";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - parsedMs) / 1000));
  if (elapsedSeconds < 60) {
    return "Just now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
  }

  if (elapsedDays < 30) {
    const elapsedWeeks = Math.floor(elapsedDays / 7);
    return `${elapsedWeeks} ${elapsedWeeks === 1 ? "week" : "weeks"} ago`;
  }

  const elapsedMonths = Math.floor(elapsedDays / 30);
  return `${elapsedMonths} ${elapsedMonths === 1 ? "month" : "months"} ago`;
}
