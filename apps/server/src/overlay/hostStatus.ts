import { readFile } from "node:fs/promises";
import path from "node:path";

/** Status the Electron shell writes when it parks or runs the In-game overlay host. */
export type OverlayHostStatus = {
  state: "parked" | "running" | "absent";
  reason: "unsupported" | "crash-loop" | null;
  at: number | null;
};

const HOST_STATUS_FILE = "overlay-host-status.json";

function absent(): OverlayHostStatus {
  return { state: "absent", reason: null, at: null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept only parked/running, unsupported/crash-loop/null, and a finite `at`
 * (or null). Missing keys, unexpected states, or any other garbage → absent.
 * Never throws.
 */
export function parseOverlayHostStatus(raw: string): OverlayHostStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return absent();
  }
  if (!isPlainObject(parsed)) return absent();

  const keys = Object.keys(parsed);
  if (
    keys.length !== 3 ||
    !keys.includes("state") ||
    !keys.includes("reason") ||
    !keys.includes("at")
  ) {
    return absent();
  }

  const { state, reason, at } = parsed;
  if (state !== "parked" && state !== "running") return absent();
  if (reason !== "unsupported" && reason !== "crash-loop" && reason !== null) {
    return absent();
  }
  if (at !== null && (typeof at !== "number" || !Number.isFinite(at))) {
    return absent();
  }

  return { state, reason, at };
}

export function overlayHostStatusPath(dataDir: string): string {
  return path.join(dataDir, HOST_STATUS_FILE);
}

/** Missing, unreadable, or invalid file → absent. Never throws. */
export async function readOverlayHostStatus(
  dataDir: string,
): Promise<OverlayHostStatus> {
  try {
    const raw = await readFile(overlayHostStatusPath(dataDir), "utf8");
    return parseOverlayHostStatus(raw);
  } catch {
    return absent();
  }
}
