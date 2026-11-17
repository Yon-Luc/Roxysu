import { lstatSync, statSync } from "node:fs";
import path from "node:path";

const MAX_EXECUTABLE_PATH = 1024;

export type ExecutablePathResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Minimum check before spawn: absolute path to a regular file.
 * This does not stop a chosen binary. It rejects typos, directories,
 * device nodes, and dangling links.
 */
export function assertSafeExecutablePath(raw: string): ExecutablePathResult {
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
    return { ok: true, path: trimmed };
  }
  if (!st.isFile()) {
    return { ok: false, error: "Executable path must be a file" };
  }
  return { ok: true, path: trimmed };
}
