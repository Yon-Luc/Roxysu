import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  overlayHostStatusPath,
  parseOverlayHostStatus,
  readOverlayHostStatus,
  type OverlayHostStatus,
} from "./hostStatus";

const ABSENT: OverlayHostStatus = { state: "absent", reason: null, at: null };

describe("parseOverlayHostStatus", () => {
  test("accepts parked/unsupported", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({
          state: "parked",
          reason: "unsupported",
          at: 1730000000000,
        }),
      ),
    ).toEqual({
      state: "parked",
      reason: "unsupported",
      at: 1730000000000,
    });
  });

  test("accepts parked/crash-loop", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({
          state: "parked",
          reason: "crash-loop",
          at: 1730000000001,
        }),
      ),
    ).toEqual({
      state: "parked",
      reason: "crash-loop",
      at: 1730000000001,
    });
  });

  test("accepts running with a null reason", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({ state: "running", reason: null, at: 42 }),
      ),
    ).toEqual({ state: "running", reason: null, at: 42 });
  });

  test("accepts a null at timestamp", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({ state: "running", reason: null, at: null }),
      ),
    ).toEqual({ state: "running", reason: null, at: null });
  });

  test("missing keys become absent", () => {
    expect(parseOverlayHostStatus(JSON.stringify({ state: "parked" }))).toEqual(
      ABSENT,
    );
    expect(
      parseOverlayHostStatus(
        JSON.stringify({ state: "parked", reason: "unsupported" }),
      ),
    ).toEqual(ABSENT);
    expect(parseOverlayHostStatus("{}")).toEqual(ABSENT);
  });

  test("a wrong state becomes absent", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({ state: "stopped", reason: null, at: 1 }),
      ),
    ).toEqual(ABSENT);
  });

  test("a wrong reason becomes absent", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({ state: "parked", reason: "nope", at: 1 }),
      ),
    ).toEqual(ABSENT);
  });

  test("a non-finite at becomes absent", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({ state: "running", reason: null, at: "173" }),
      ),
    ).toEqual(ABSENT);
  });

  test("extra keys are garbage and become absent", () => {
    expect(
      parseOverlayHostStatus(
        JSON.stringify({
          state: "parked",
          reason: "unsupported",
          at: 1,
          extra: true,
        }),
      ),
    ).toEqual(ABSENT);
  });

  test("bad JSON and an empty string become absent", () => {
    expect(parseOverlayHostStatus("{")).toEqual(ABSENT);
    expect(parseOverlayHostStatus("not json")).toEqual(ABSENT);
    expect(parseOverlayHostStatus("")).toEqual(ABSENT);
    expect(
      parseOverlayHostStatus(
        `${JSON.stringify({ state: "parked", reason: "unsupported", at: 1 })} trailing`,
      ),
    ).toEqual(ABSENT);
  });
});

describe("overlayHostStatusPath", () => {
  test("joins the data dir and the status file name", () => {
    expect(overlayHostStatusPath("/tmp/roxysu-data")).toBe(
      path.join("/tmp/roxysu-data", "overlay-host-status.json"),
    );
  });
});

describe("readOverlayHostStatus", () => {
  test("a temp dir with no file is absent", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-host-status-"));
    try {
      expect(await readOverlayHostStatus(dir)).toEqual(ABSENT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a temp dir with a valid file returns that status", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-host-status-"));
    const status: OverlayHostStatus = {
      state: "parked",
      reason: "unsupported",
      at: 1730000000000,
    };
    try {
      writeFileSync(
        overlayHostStatusPath(dir),
        JSON.stringify(status),
        "utf8",
      );
      expect(await readOverlayHostStatus(dir)).toEqual(status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid JSON in the file is absent and does not throw", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-host-status-"));
    try {
      writeFileSync(overlayHostStatusPath(dir), "{", "utf8");
      expect(await readOverlayHostStatus(dir)).toEqual(ABSENT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
