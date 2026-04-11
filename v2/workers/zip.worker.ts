/// <reference lib="webworker" />
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { ArchiveWorkPlan } from "../src/types/domain";

interface BuildArchiveMessage {
  type: "build-archive";
  payload: ArchiveWorkPlan;
}

const ZIP_FETCH_CONCURRENCY = 4;

self.addEventListener("message", (event: MessageEvent<BuildArchiveMessage>) => {
  if (event.data.type !== "build-archive") {
    return;
  }

  void buildArchive(event.data.payload).catch((error) => {
    self.postMessage({
      type: "error",
      payload: { error: error instanceof Error ? error.message : String(error) }
    });
  });
});

async function buildArchive(workPlan: ArchiveWorkPlan): Promise<void> {
  const libraryPathByVideoId = new Map(workPlan.organizer_rows.map((row) => [row.video_id, row.library_path]));
  const chunks: Uint8Array[] = [];
  let completedItems = 0;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      throw error;
    }
    chunks.push(chunk);
    if (final) {
      const archiveBlob = new Blob(chunks as unknown as BlobPart[], { type: "application/zip" });
      self.postMessage(
        {
          type: "complete",
          payload: {
            archive_name: workPlan.archive_name,
            blob: archiveBlob
          }
        }
      );
    }
  });

  await runWithConcurrency(workPlan.rows, ZIP_FETCH_CONCURRENCY, async (row) => {
    const response = await fetch(`https://soravdl.com/api/proxy/video/${encodeURIComponent(row.video_id)}`);
    if (!response.ok) {
      throw new Error(`soraVDL download failed for ${row.video_id} with status ${response.status}.`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const entry = new ZipPassThrough(libraryPathByVideoId.get(row.video_id) ?? `library/${row.video_id}.mp4`);
    zip.add(entry);
    entry.push(bytes, true);
    completedItems += 1;

    self.postMessage({
      type: "progress",
      payload: {
        active_label: `Bundled ${row.title || row.video_id}`,
        completed_items: completedItems,
        total_items: workPlan.rows.length
      }
    });
  });

  for (const supplementalEntry of workPlan.supplemental_entries) {
    const entry = new ZipPassThrough(supplementalEntry.archive_path);
    zip.add(entry);
    if (typeof supplementalEntry.content === "string") {
      entry.push(strToU8(supplementalEntry.content), true);
    } else {
      entry.push(new Uint8Array(await supplementalEntry.content.arrayBuffer()), true);
    }
  }

  zip.end();
}

async function runWithConcurrency<T>(values: T[], concurrency: number, workerFn: (value: T, index: number) => Promise<void>): Promise<void> {
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < values.length) {
      const index = currentIndex;
      const value = values[index];
      currentIndex += 1;
      await workerFn(value, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
}
