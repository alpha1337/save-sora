import type { VideoRow } from "types/domain";
import { useAppStore } from "@app/store/use-app-store";
import { loadSessionDbSnapshot } from "@lib/db/session-db";
import { downloadTextFile } from "@lib/utils/download-utils";

const CSV_COLUMNS = [
  "row_id",
  "video_id",
  "source_type",
  "source_bucket",
  "title",
  "prompt",
  "discovery_phrase",
  "description",
  "caption",
  "creator_name",
  "creator_username",
  "character_name",
  "character_username",
  "character_names",
  "category_tags",
  "created_at",
  "published_at",
  "like_count",
  "view_count",
  "share_count",
  "repost_count",
  "remix_count",
  "detail_url",
  "thumbnail_url",
  "duration_seconds",
  "estimated_size_bytes",
  "width",
  "height",
  "is_downloadable",
  "skip_reason",
  "raw_payload_json"
] as const;

/**
 * Produces the fixed-schema CSV export from normalized session rows.
 */
export function exportSessionRowsToCsv(): void {
  void buildAndDownloadCsv();
}

async function buildAndDownloadCsv(): Promise<void> {
  const { settings } = useAppStore.getState();
  const sessionSnapshot = await loadSessionDbSnapshot();
  const rows = sessionSnapshot.video_rows;
  const header = CSV_COLUMNS.join(",");
  const csvRows = rows.map((row) =>
    CSV_COLUMNS.map((column) => escapeCsvValue(formatColumnValue(column, row, settings.include_raw_payload_in_csv))).join(",")
  );
  const csvText = [header, ...csvRows].join("\n");
  downloadTextFile("save-sora-metadata.csv", csvText, "text/csv;charset=utf-8");
}

function formatColumnValue(column: (typeof CSV_COLUMNS)[number], row: VideoRow, includeRawPayload: boolean): string {
  if (column === "raw_payload_json" && !includeRawPayload) {
    return "";
  }
  if (column === "character_names") {
    return row.character_names.join(" | ");
  }
  if (column === "category_tags") {
    return row.category_tags.join(" | ");
  }

  const value = row[column];
  return value == null ? "" : String(value);
}

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
