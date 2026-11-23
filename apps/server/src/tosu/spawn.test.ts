import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnTosu } from "./spawn";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "roxysu-spawn-"));
  dirs.push(dir);
  return dir;
}

/** Wait for a callback fired from the child's next tick. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("spawnTosu", () => {
  test("reports a missing executable synchronously", () => {
    const missing = path.join(tempDir(), "does-not-exist");
    let errorReported = false;
    const result = spawnTosu(missing, {
      onError: () => {
        errorReported = true;
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.warning).toContain("not found");
    expect(errorReported).toBe(false);
  });

  test("handles an async exec failure instead of crashing the process", async () => {
    // A regular file without the execute bit: spawn() returns, then delivers
    // EACCES on the child's 'error' event. Before the listener existed this was
    // an uncaughtException that killed the client app.
    const notExecutable = path.join(tempDir(), "tosu.txt");
    writeFileSync(notExecutable, "#!/bin/sh\necho hi\n");
    chmodSync(notExecutable, 0o644);

    const warnings: string[] = [];
    const result = spawnTosu(notExecutable, {
      onError: (warning) => warnings.push(warning),
    });

    // The sync result cannot know yet; it may report a pid or no pid.
    expect(result.ok || result.warning.length > 0).toBe(true);

    await waitFor(() => warnings.length > 0);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Failed to start tosu");
  });

  test("reports a directory path synchronously", () => {
    const result = spawnTosu(tempDir());
    expect(result.ok).toBe(false);
  });
});
