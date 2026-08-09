/** In-memory one-shot hub OAuth handoff for Electron system-browser login. */

import { randomBytes } from "node:crypto";

const TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 64;

type Pending = {
  /** Set when browser hits /complete with matching handoff id. */
  ready: boolean;
  expiresAt: number;
};

const pendingById = new Map<string, Pending>();

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of pendingById) {
    if (entry.expiresAt <= now) pendingById.delete(id);
  }
  if (pendingById.size <= MAX_PENDING) return;
  const overflow = pendingById.size - MAX_PENDING;
  let i = 0;
  for (const id of pendingById.keys()) {
    pendingById.delete(id);
    i += 1;
    if (i >= overflow) break;
  }
}

function randomHandoffId(): string {
  return randomBytes(24).toString("base64url");
}

/** Start a desktop login — returns an opaque handoff id the UI must poll. */
export function beginHubOAuthHandoff(): string {
  prune();
  const id = randomHandoffId();
  pendingById.set(id, { ready: false, expiresAt: Date.now() + TTL_MS });
  return id;
}

/**
 * Mark a handoff ready after the browser lands on /complete.
 * Rejects unknown ids (cannot deposit arbitrary JWTs).
 */
export function markHubOAuthHandoffReady(handoffId: string): boolean {
  prune();
  const id = handoffId.trim();
  if (!id) return false;
  const entry = pendingById.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingById.delete(id);
    return false;
  }
  entry.ready = true;
  entry.expiresAt = Date.now() + TTL_MS;
  return true;
}

/**
 * Returns whether this handoff is ready for JWT redeem (does not consume).
 * Caller redeems the JWT from the hub using the same id.
 */
export function peekHubOAuthHandoffReady(handoffId: string): boolean {
  prune();
  const entry = pendingById.get(handoffId.trim());
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) pendingById.delete(handoffId.trim());
    return false;
  }
  return entry.ready;
}

/** Clear after successful JWT redeem (or abandon). */
export function clearHubOAuthHandoff(handoffId: string): void {
  pendingById.delete(handoffId.trim());
}

/** Test helper. */
export function clearAllHubOAuthHandoffs(): void {
  pendingById.clear();
}
