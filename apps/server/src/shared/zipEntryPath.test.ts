import { describe, expect, test } from "bun:test";
import { sanitizeZipEntryPath } from "./zipEntryPath";

describe("sanitizeZipEntryPath", () => {
  test("keeps ordinary relative names", () => {
    expect(sanitizeZipEntryPath("skin.ini")).toBe("skin.ini");
    expect(sanitizeZipEntryPath("Cool Skin/mania-note1.png")).toBe(
      "Cool Skin/mania-note1.png",
    );
    expect(sanitizeZipEntryPath("a..b/c..png")).toBe("a..b/c..png");
  });

  test("normalizes separators and redundant segments", () => {
    expect(sanitizeZipEntryPath("a\\b\\c.png")).toBe("a/b/c.png");
    expect(sanitizeZipEntryPath("./a//b/./c.png")).toBe("a/b/c.png");
    expect(sanitizeZipEntryPath("dir/")).toBe("dir");
  });

  test.each([
    "../evil.txt",
    "a/../../evil.txt",
    "a/b/..",
    "..\\evil.txt",
    "a\\..\\..\\evil.txt",
    "..",
  ])("rejects traversal: %s", (name) => {
    expect(sanitizeZipEntryPath(name)).toBeNull();
  });

  test.each([
    "/etc/passwd",
    "\\windows\\system32",
    "//server/share/x",
    "C:/Windows/x",
    "c:\\x",
    "C:evil.txt",
  ])("rejects absolute and drive paths: %s", (name) => {
    expect(sanitizeZipEntryPath(name)).toBeNull();
  });

  test("rejects NUL bytes and empty results", () => {
    expect(sanitizeZipEntryPath("skin.ini\0.png")).toBeNull();
    expect(sanitizeZipEntryPath("\0")).toBeNull();
    expect(sanitizeZipEntryPath("")).toBeNull();
    expect(sanitizeZipEntryPath(".")).toBeNull();
    expect(sanitizeZipEntryPath("./")).toBeNull();
  });
});
