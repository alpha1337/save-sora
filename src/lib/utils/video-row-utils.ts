import type { VideoRow } from "types/domain";

/**
 * Keeps large raw payload blobs out of the UI store while preserving them in
 * IndexedDB for CSV export and debugging.
 */
export function stripRawPayloadFromRows(rows: VideoRow[]): VideoRow[] {
  return rows.map((row) => ({
    ...row,
    raw_payload_json: ""
  }));
}
