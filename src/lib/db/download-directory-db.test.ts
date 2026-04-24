import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDownloadDirectoryHandle,
  loadDownloadDirectoryHandle,
  saveDownloadDirectoryHandle
} from "./download-directory-db";
import { openSessionDb } from "./session-db";

describe("download-directory-db", () => {
  beforeEach(async () => {
    const database = await openSessionDb();
    await database.clear("settings");
  });

  it("saves, loads, and clears the selected download directory handle", async () => {
    const handle = {
      kind: "directory",
      name: "Sora exports"
    } as FileSystemDirectoryHandle;

    await saveDownloadDirectoryHandle(handle);
    await expect(loadDownloadDirectoryHandle()).resolves.toEqual(handle);

    await clearDownloadDirectoryHandle();
    await expect(loadDownloadDirectoryHandle()).resolves.toBeNull();
  });
});
