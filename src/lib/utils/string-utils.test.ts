import { describe, expect, it } from "vitest";
import { sanitizeFileNamePart } from "./string-utils";

describe("sanitizeFileNamePart", () => {
  it("removes Windows-invalid filename characters", () => {
    expect(sanitizeFileNamePart("a/b:c*?\"<>|", "item")).toBe("a-b-c");
  });

  it("removes control characters and normalizes unicode to safe ASCII", () => {
    expect(sanitizeFileNamePart("  tr\u0000e\u0001s café 😅  ", "item")).toBe("tres cafe");
  });

  it("avoids reserved Windows device names", () => {
    expect(sanitizeFileNamePart("CON", "item")).toBe("CON-item");
    expect(sanitizeFileNamePart("LPT1", "item")).toBe("LPT1-item");
  });
});
