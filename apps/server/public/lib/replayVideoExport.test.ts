import { describe, expect, test } from "bun:test";
import type { StreamTargetChunk } from "mediabunny";
import {
  REPLAY_VIDEO_EXPORT_PRESETS,
  REPLAY_VIDEO_MEMORY_WARN_BYTES,
  computeHud,
  createGuardedFileWritable,
  discardStreamedFile,
  getReplayVideoExportPreset,
  pickReplayVideoSaveHandle,
  STREAMED_EXPORT_EMPTY_FILE_ERROR,
  streamedExportError,
  replayVideoMemoryRisk,
  shouldStreamToDisk,
  supportsStreamingSave,
  teardownFailedOutput,
  type CancelableOutput,
} from "./replayVideoExport";

function fakeOutput(state: string, cancelImpl?: () => Promise<void>) {
  let cancels = 0;
  const output: CancelableOutput & { cancels: () => number } = {
    state,
    cancel: async () => {
      cancels += 1;
      output.state = "canceled";
      await cancelImpl?.();
    },
    cancels: () => cancels,
  };
  return output;
}

describe("teardownFailedOutput", () => {
  test("cancels a started output", async () => {
    const out = fakeOutput("started");
    await teardownFailedOutput(out);
    expect(out.cancels()).toBe(1);
  });

  test("does not cancel a finalized or already canceled output", async () => {
    const done = fakeOutput("finalized");
    const gone = fakeOutput("canceled");
    await teardownFailedOutput(done);
    await teardownFailedOutput(gone);
    expect(done.cancels()).toBe(0);
    expect(gone.cancels()).toBe(0);
  });

  test("swallows a cancel failure so the original error surfaces", async () => {
    const out = fakeOutput("started", async () => {
      throw new Error("cancel failed");
    });
    await expect(teardownFailedOutput(out)).resolves.toBeUndefined();
  });
});

function recordingFile() {
  const log: string[] = [];
  const chunks: StreamTargetChunk[] = [];
  const file = new WritableStream<StreamTargetChunk>({
    write: (c) => {
      chunks.push(c);
    },
    close: () => {
      log.push("close");
    },
    abort: () => {
      log.push("abort");
    },
  });
  return { file, log, chunks };
}

const chunk = (position: number): StreamTargetChunk => ({
  type: "write",
  data: new Uint8Array(4),
  position,
});

describe("createGuardedFileWritable", () => {
  test("forwards writes and commits when marked complete", async () => {
    const { file, log, chunks } = recordingFile();
    const g = createGuardedFileWritable(file);
    const w = g.stream.getWriter();
    await w.write(chunk(0));
    g.markComplete();
    await w.close();
    expect(chunks).toHaveLength(1);
    expect(log).toEqual(["close"]);
  });

  test("a close before completion aborts the file (cancelled export)", async () => {
    const { file, log } = recordingFile();
    const g = createGuardedFileWritable(file);
    const w = g.stream.getWriter();
    await w.write(chunk(0));
    await w.close();
    expect(log).toEqual(["abort"]);
  });
});

describe("discardStreamedFile", () => {
  test("remove is called on abort before createWritable", async () => {
    let removed = 0;
    let created = 0;
    const handle = {
      createWritable: async () => {
        created += 1;
        return new WritableStream<StreamTargetChunk>();
      },
      remove: async () => {
        removed += 1;
      },
    };
    expect(await discardStreamedFile(handle)).toBe(true);
    expect(removed).toBe(1);
    expect(created).toBe(0);
  });

  test("a missing remove returns false and sets the empty-file error", async () => {
    const handle = {
      createWritable: async () => new WritableStream<StreamTargetChunk>(),
    };
    const removed = await discardStreamedFile(handle);
    expect(removed).toBe(false);
    expect(
      streamedExportError(
        handle,
        removed,
        new DOMException("Export cancelled", "AbortError"),
      ),
    ).toBe(STREAMED_EXPORT_EMPTY_FILE_ERROR);
  });
});

describe("streaming save selection", () => {
  const discord = getReplayVideoExportPreset("discord");
  const hq = getReplayVideoExportPreset("1080");

  test("detects showSaveFilePicker", () => {
    expect(supportsStreamingSave({})).toBe(false);
    expect(supportsStreamingSave({ showSaveFilePicker: () => {} })).toBe(true);
  });

  test("size-capped presets never stream; uncapped presets stream when supported", () => {
    expect(shouldStreamToDisk(discord, true)).toBe(false);
    expect(shouldStreamToDisk(getReplayVideoExportPreset("compact"), true)).toBe(
      false,
    );
    expect(shouldStreamToDisk(hq, true)).toBe(true);
    expect(shouldStreamToDisk(hq, false)).toBe(false);
  });

  test("every preset is either capped or streamable", () => {
    for (const p of REPLAY_VIDEO_EXPORT_PRESETS) {
      expect(shouldStreamToDisk(p, true)).toBe(p.fitUnderBytes == null);
    }
  });

  test("memory risk warns only when buffering a large estimate", () => {
    const big = REPLAY_VIDEO_MEMORY_WARN_BYTES + 1;
    expect(replayVideoMemoryRisk(big, hq, true)).toBe("stream");
    expect(replayVideoMemoryRisk(big, hq, false)).toBe("warn");
    expect(replayVideoMemoryRisk(1024, hq, false)).toBe("ok");
    expect(replayVideoMemoryRisk(big, discord, false)).toBe("warn");
    expect(replayVideoMemoryRisk(20 * 1024 * 1024, discord, false)).toBe("ok");
  });

  test("picker is invoked with the filename and an mp4 filter", async () => {
    const calls: unknown[] = [];
    const handle = { createWritable: async () => new WritableStream() };
    const host = {
      showSaveFilePicker: async (opts: unknown) => {
        calls.push(opts);
        return handle;
      },
    };
    await expect(pickReplayVideoSaveHandle("a.mp4", host)).resolves.toBe(handle);
    expect(calls[0]).toMatchObject({
      suggestedName: "a.mp4",
      types: [{ accept: { "video/mp4": [".mp4"] } }],
    });
    await expect(pickReplayVideoSaveHandle("a.mp4", {})).rejects.toThrow();
  });
});

describe("computeHud taiko rows", () => {
  const rows = [
    { tMs: 100, result: "great" as const, kind: "hit" },
    { tMs: 200, result: "great" as const, kind: "roll" },
    { tMs: 300, result: "miss" as const, kind: "swell" },
    { tMs: 400, result: "miss" as const, kind: "hit" },
  ];

  test("skips roll and swell rows for taiko", () => {
    const hud = computeHud(rows, 350, "taiko");
    expect(hud.combo).toBe(1);
    expect(hud.accuracy).toBe(1);
    expect(hud.last).toBe("great");
  });

  test("still counts every row for other rulesets", () => {
    const hud = computeHud(rows, 350, "mania");
    expect(hud.combo).toBe(0);
    expect(hud.last).toBe("miss");
  });
});
