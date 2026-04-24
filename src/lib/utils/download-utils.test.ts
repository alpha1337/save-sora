import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeBlobToDirectory } from "./file-system-access";
import { downloadBlob } from "./download-utils";

vi.mock("./file-system-access", () => ({
  writeBlobToDirectory: vi.fn()
}));

const writeBlobToDirectoryMock = vi.mocked(writeBlobToDirectory);
const createObjectUrlMock = vi.fn(() => "blob:save-sora-test");
const revokeObjectUrlMock = vi.fn();

describe("download-utils", () => {
  beforeEach(() => {
    writeBlobToDirectoryMock.mockReset();
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock
    });
  });

  it("writes blobs to the selected directory when available", async () => {
    const directoryHandle = { kind: "directory", name: "Sora exports" } as FileSystemDirectoryHandle;
    const blob = new Blob(["zip"]);
    writeBlobToDirectoryMock.mockResolvedValue(true);

    await expect(downloadBlob("archive.zip", blob, { directoryHandle })).resolves.toBe("directory");

    expect(writeBlobToDirectoryMock).toHaveBeenCalledWith(directoryHandle, "archive.zip", blob);
    expect(createObjectUrlMock).not.toHaveBeenCalled();
  });

  it("falls back to browser downloads when the directory is unavailable", async () => {
    const directoryHandle = { kind: "directory", name: "Sora exports" } as FileSystemDirectoryHandle;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    writeBlobToDirectoryMock.mockResolvedValue(false);

    await expect(downloadBlob("archive.zip", new Blob(["zip"]), { directoryHandle })).resolves.toBe("browser");

    expect(createObjectUrlMock).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
