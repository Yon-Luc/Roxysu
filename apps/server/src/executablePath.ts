import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_EXECUTABLE_PATH = 1024;

export type ExecutablePathResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export type ExecutablePathOptions = {
  /**
   * Absolute directories the executable must resolve inside. Symlinks are
   * resolved first, so a link inside an allowed root that points outside is
   * rejected. An explicitly empty list rejects every candidate.
   */
  allowedRoots?: readonly string[];
  /** Require the POSIX execute bit (`X_OK`). */
  requireExecutable?: boolean;
  /**
   * Reject files any local user can modify (POSIX world-writable bit).
   * No effect on Windows, where the mode bits are synthetic.
   */
  rejectWorldWritable?: boolean;
  /** Reject paths inside `os.tmpdir()`. */
  rejectTempDir?: boolean;
};

/** Resolve symlinks and `..`; fall back to a lexical resolve if the path is gone. */
function canonicalPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/** True when `candidate` is `root` or sits below it (no prefix/traversal tricks). */
function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(rel))
  );
}

/**
 * Minimum check before spawn: absolute path to a regular file.
 *
 * Optional checks narrow *which* absolute file is accepted:
 * - `allowedRoots` for app-managed trees (calculators);
 * - `requireExecutable` and the writability/temp guards for a user-chosen
 *   binary, where a hard allowlist would break the feature.
 *
 * The default (no options) keeps the historical behaviour: rejects typos,
 * directories, device nodes, and dangling links, but does not restrict the
 * directory. Callers that spawn must pass the checks they need.
 */
export function assertSafeExecutablePath(
  raw: string,
  opts: ExecutablePathOptions = {},
): ExecutablePathResult {
  if (raw.includes("\0") || /[\r\n]/.test(raw)) {
    return { ok: false, error: "Executable path is invalid" };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_EXECUTABLE_PATH) {
    return { ok: false, error: "Executable path is invalid" };
  }
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: "Executable path must be absolute" };
  }
  let st;
  try {
    st = lstatSync(trimmed);
  } catch {
    return { ok: false, error: "Executable not found" };
  }
  if (st.isSymbolicLink()) {
    try {
      if (!statSync(trimmed).isFile()) {
        return { ok: false, error: "Executable path must be a file" };
      }
    } catch {
      return { ok: false, error: "Executable not found" };
    }
  } else if (!st.isFile()) {
    return { ok: false, error: "Executable path must be a file" };
  }

  // Real path for containment/permission checks. The stored path stays the
  // user-visible one (so a symlink inside an allowed root keeps working).
  const canonical = canonicalPath(trimmed);

  if (opts.allowedRoots !== undefined) {
    const roots = opts.allowedRoots
      .filter((root) => root.trim().length > 0)
      .map((root) => canonicalPath(path.resolve(root.trim())));
    if (!roots.some((root) => isWithinRoot(root, canonical))) {
      return {
        ok: false,
        error: "Executable path is not inside an allowed directory",
      };
    }
  }

  if (opts.rejectWorldWritable && process.platform !== "win32") {
    let mode: number;
    try {
      mode = statSync(canonical).mode;
    } catch {
      return { ok: false, error: "Executable not found" };
    }
    if ((mode & 0o002) !== 0) {
      return {
        ok: false,
        error: "Executable must not be writable by every user",
      };
    }
  }

  if (
    opts.rejectTempDir &&
    isWithinRoot(canonicalPath(os.tmpdir()), canonical)
  ) {
    return {
      ok: false,
      error: "Executable must not live in a temporary directory",
    };
  }

  if (opts.requireExecutable) {
    try {
      accessSync(canonical, fsConstants.X_OK);
    } catch {
      return {
        ok: false,
        error: "Executable is not runnable (missing execute permission)",
      };
    }
  }

  return { ok: true, path: trimmed };
}
