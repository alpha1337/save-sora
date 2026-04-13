import type { MouseEvent, ReactElement } from "react";
import { Clock3, ExternalLink, Eye, Heart, PlayCircle, Repeat2 } from "lucide-react";
import type { VideoRow } from "types/domain";
import { Checkbox } from "@components/atoms/checkbox";
import { formatBytes, formatCount, formatDate, formatDuration } from "@lib/utils/format-utils";
import { resolvePreviewPlaybackUrl } from "@lib/utils/video-playback";

interface VideoMetadataCardProps {
  row: VideoRow;
  selected: boolean;
  previewActive: boolean;
  skipReasonLabel: string;
  onPreviewToggle: (rowId: string) => void;
  onToggleSelectedVideoId: (videoId: string) => void;
}

/**
 * Metadata-first card view with inline video preview controls.
 */
export function VideoMetadataCard({
  onPreviewToggle,
  onToggleSelectedVideoId,
  previewActive,
  row,
  selected,
  skipReasonLabel
}: VideoMetadataCardProps) {
  const canSelect = Boolean(row.is_downloadable && row.video_id);
  const previewUrl = resolvePreviewPlaybackUrl(row);
  const canPlay = Boolean(previewUrl);
  const characterLine = row.character_names.join(", ") || row.character_name || "";
  const cardTitle = resolveCardTitle(row);
  const fileSizeLabel = resolveFileSizeLabel(row);
  const visibleThumbStats = [
    row.duration_seconds && row.duration_seconds > 0
      ? { icon: <Clock3 aria-hidden="true" size={12} />, value: formatDuration(row.duration_seconds) }
      : null,
    row.view_count && row.view_count > 0
      ? { icon: <Eye aria-hidden="true" size={12} />, value: formatCount(row.view_count) }
      : null,
    row.like_count && row.like_count > 0
      ? { icon: <Heart aria-hidden="true" size={12} />, value: formatCount(row.like_count) }
      : null,
    row.remix_count && row.remix_count > 0
      ? { icon: <Repeat2 aria-hidden="true" size={12} />, value: formatCount(row.remix_count) }
      : null
  ].filter((entry): entry is { icon: ReactElement; value: string } => Boolean(entry));
  const visibleMetaEntries = [
    { label: "Source", value: row.source_type },
    { label: "Creator", value: row.creator_name },
    { label: "Character", value: characterLine },
    { label: "Published", value: formatDate(row.published_at) },
    { label: "File Size", value: fileSizeLabel }
  ].filter((entry) => isVisibleStatValue(entry.value));
  const cardClasses = `ss-results-card${canSelect ? " is-selectable" : ""}`;

  function handleCardClick(event: MouseEvent<HTMLElement>): void {
    if (!canSelect || shouldIgnoreCardToggle(event.target)) {
      return;
    }

    onToggleSelectedVideoId(row.video_id);
  }

  return (
    <article className={cardClasses} onClick={handleCardClick}>
      <div className="ss-results-card-header">
        <Checkbox
          checked={selected}
          disabled={!canSelect}
          id={`row-${row.row_id}`}
          label=""
          ariaLabel={`Select ${cardTitle}`}
          onCheckedChange={() => onToggleSelectedVideoId(row.video_id)}
        />
        <div className="ss-results-card-title-wrap">
          <strong className="ss-results-card-title">{cardTitle}</strong>
          {!row.is_downloadable && skipReasonLabel ? <div className="ss-muted">{skipReasonLabel}</div> : null}
        </div>
      </div>

      <div className="ss-results-media-shell">
        <div className="ss-results-thumb-shell">
          {previewActive && canPlay ? (
            <video
              autoPlay
              className="ss-results-card-thumb"
              controls
              playsInline
              poster={row.thumbnail_url || undefined}
              preload="metadata"
              src={previewUrl}
            />
          ) : row.thumbnail_url ? (
            <img alt={cardTitle} className="ss-results-card-thumb" loading="lazy" src={row.thumbnail_url} />
          ) : (
            <div className="ss-results-card-thumb ss-results-card-thumb--empty">No preview</div>
          )}
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
        <div className="ss-results-media-actions">
          <button
            className="ss-media-action-button"
            disabled={!canPlay}
            onClick={() => onPreviewToggle(row.row_id)}
            type="button"
          >
            <PlayCircle aria-hidden="true" size={16} />
            {previewActive ? "Show thumbnail" : "Play preview"}
          </button>
          {row.detail_url ? (
            <a className="ss-media-action-link" href={row.detail_url} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={14} />
              Open in Sora
            </a>
          ) : null}
        </div>
      </div>

      {visibleMetaEntries.length > 0 ? (
        <dl className="ss-results-card-meta">
          {visibleMetaEntries.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
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
  const candidates = [row.title, row.discovery_phrase, row.caption, row.description, row.prompt];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "Untitled video";
}

function resolveFileSizeLabel(row: VideoRow): string {
  if (row.source_bucket === "drafts" && (!row.video_id || row.skip_reason === "unresolved_draft_video_id")) {
    return "Calculating...";
  }

  return formatBytes(row.estimated_size_bytes);
}

function isVisibleStatValue(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed && trimmed !== "-" && trimmed !== "0");
}
