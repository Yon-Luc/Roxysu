import { spawn } from "node:child_process";
import path from "node:path";
import { assertSafeExecutablePath } from "../executablePath";

export type SpawnTosuResult =
  | { ok: true; pid: number }
  | { ok: false; warning: string };

export type SpawnTosuOptions = {
  /**
   * Exec failures (ENOENT, EACCES, a non-executable file, a wrong-arch binary)
   * arrive as an asynchronous `'error'` event after this function has already
   * returned. Report them here instead of leaving the event unhandled: an
   * unhandled `'error'` on a ChildProcess is an `uncaughtException`, and the
   * client app has no handler for one.
   */
  onError?: (warning: string) => void;
};

/**
 * Start tosu from a configured executable path.
 * Detached so Roxysu shutdown does not kill it.
 */
export function spawnTosu(
  executablePath: string,
  opts: SpawnTosuOptions = {},
): SpawnTosuResult {
  const trimmed = executablePath.trim();
  if (!trimmed) {
    return {
      ok: false,
      warning:
        "Tosu executable path is not configured. Set it in Settings to auto-start tosu.",
    };
  }

  const checked = assertSafeExecutablePath(trimmed);
  if (!checked.ok) {
    return { ok: false, warning: checked.error };
  }

  try {
    const cwd = path.dirname(checked.path);
    const child = spawn(checked.path, [], {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    // Must be attached before the caller returns: the failure is delivered on
    // the next tick, and an unhandled 'error' would take the process down.
    child.on("error", (err) => {
      opts.onError?.(
        `Failed to start tosu: ${err instanceof Error ? err.message : String(err)}`,
      );
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
