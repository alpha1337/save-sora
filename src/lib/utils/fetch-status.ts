import type { FetchProgressState, LowLevelSourceType } from "types/domain";

const CURSOR_PREVIEW_LIMIT = 48;

export interface FetchBatchErrorContext {
  batchNumber: number;
  cursor: string | null;
  endpointKey: string | null;
  jobLabel: string;
  offset: number | null;
  source: LowLevelSourceType;
}

export interface FetchLabelRowLike {
  row_id?: string;
  title?: string;
  video_id?: string;
}

export function getFetchQueuedLabel(): string {
  return "Queued";
}

export function getFetchPageLabel(batchNumber: number): string {
  return `Fetching page ${Math.max(1, batchNumber)}...`;
}

export function getFetchRequestingBatchLabel(batchNumber: number, source: LowLevelSourceType, endpointKey?: string | null): string {
  return `Requesting ${formatEndpointLabel(source, endpointKey)} page ${Math.max(1, batchNumber)}...`;
}

export function getFetchReceivedBatchLabel(
  batchNumber: number,
  rowCount: number,
  source: LowLevelSourceType,
  endpointKey?: string | null
): string {
  return `Received ${rowCount} rows from ${formatEndpointLabel(source, endpointKey)} page ${Math.max(1, batchNumber)}`;
}

export function getFetchNormalizingBatchLabel(rowCount: number): string {
  return `Normalizing ${Math.max(0, rowCount)} rows...`;
}

export function getFetchPersistingBatchLabel(rowCount: number): string {
  return `Persisting ${Math.max(0, rowCount)} rows...`;
}

export function getFetchResolvingDraftIdsLabel(resolvedCount: number, totalCount: number): string {
  return `Resolving draft IDs ${Math.max(0, resolvedCount)}/${Math.max(0, totalCount)}...`;
}

export function getFetchResolvingDraftIdsProgressLabel(
  processedCount: number,
  resolvedCount: number,
  totalCount: number,
  stageLabel = ""
): string {
  const processed = Math.max(0, processedCount);
  const resolved = Math.max(0, resolvedCount);
  const total = Math.max(0, totalCount);
  const stage = stageLabel.trim();
  return stage
    ? `Resolving draft IDs ${processed}/${total} processed · ${resolved} resolved · ${stage}`
    : `Resolving draft IDs ${processed}/${total} processed · ${resolved} resolved`;
}

export function getFetchSavingCheckpointLabel(batchNumber: number): string {
  return `Saving checkpoint after page ${Math.max(1, batchNumber)}...`;
}

export function getFetchBatchCompleteLabel(batchNumber: number, newRows: number, totalRows: number): string {
  return `Page ${Math.max(1, batchNumber)} complete · +${Math.max(0, newRows)} rows · ${Math.max(0, totalRows)} total`;
}

export function getFetchSuccessfulLabel(): string {
  return "Fetch successful!";
}

export function getFetchProcessingCompleteLabel(): string {
  return "Processing complete!";
}

export function getFetchCompleteLabel(): string {
  return "Complete!";
}

export function getFetchSkippedUnavailableLabel(): string {
  return "Skipped unavailable item(s)";
}

export function pickFetchActiveItemTitle(rows: FetchLabelRowLike[], source: LowLevelSourceType): string {
  const title = rows
    .map((row) => row.title?.trim() ?? "")
    .find((value, index) => {
      if (!value) {
        return false;
      }
      const row = rows[index];
      return value !== row.video_id && value !== row.row_id;
    });

  if (!title) {
    return "Processing rows...";
  }

  return isDraftLikeSource(source) ? `Processing draft ${title}...` : `Processing ${title}...`;
}

export function getFetchJobStatusLabel(job: FetchProgressState["job_progress"][number]): string {
  if (job.active_item_title) {
    return job.active_item_title;
  }

  if (job.status === "completed") {
    return getFetchCompleteLabel();
  }

  if (job.status === "running") {
    return getFetchPageLabel(job.processed_batches + 1);
  }

  return getFetchQueuedLabel();
}

export function buildFetchBatchErrorWithContext(error: unknown, context: FetchBatchErrorContext): Error {
  const baseMessage = getUnknownErrorMessage(error);
  if (/\bContext:/i.test(baseMessage)) {
    return new Error(baseMessage);
  }

  const debugParts = [
    `job=${context.jobLabel}`,
    `source=${context.source}`,
    `batch=${Math.max(1, context.batchNumber)}`,
    `endpoint=${context.endpointKey ?? context.source}`,
    context.cursor ? `cursor=${formatToken(context.cursor, CURSOR_PREVIEW_LIMIT)}` : "",
    typeof context.offset === "number" ? `offset=${context.offset}` : ""
  ].filter(Boolean);

  return new Error(debugParts.length > 0 ? `${baseMessage} Context: ${debugParts.join(" · ")}` : baseMessage);
}

export function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error ?? "Something went wrong.").trim() || "Something went wrong.";
}

function isDraftLikeSource(source: LowLevelSourceType): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

function formatToken(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

function formatEndpointLabel(source: LowLevelSourceType, endpointKey?: string | null): string {
  const trimmedEndpoint = endpointKey?.trim() ?? "";
  if (trimmedEndpoint) {
    return trimmedEndpoint;
  }
  return source;
}
