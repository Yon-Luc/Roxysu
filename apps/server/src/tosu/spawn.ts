import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type SpawnTosuResult =
  | { ok: true; pid: number }
  | { ok: false; warning: string };

/**
 * Start tosu from a configured executable path.
 * Detached so Roxysu shutdown does not kill it.
 */
export function spawnTosu(executablePath: string): SpawnTosuResult {
  const trimmed = executablePath.trim();
  if (!trimmed) {
    return {
      ok: false,
      warning:
        "Tosu executable path is not configured. Set it in Settings to auto-start tosu.",
    };
  }

  if (!existsSync(trimmed)) {
    return {
      ok: false,
      warning: `Tosu executable not found at ${trimmed}.`,
    };
  }

  try {
    const cwd = path.dirname(trimmed);
    const child = spawn(trimmed, [], {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    if (child.pid == null) {
      return { ok: false, warning: "Failed to start tosu (no pid)." };
    }
    return { ok: true, pid: child.pid };
  } catch (err) {
    return {
      ok: false,
      warning: `Failed to start tosu: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
