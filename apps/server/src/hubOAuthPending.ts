/** In-memory one-shot hub OAuth handoff for Electron system-browser login. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 64;

type Pending = {
  /** base64url SHA-256 of the verifier returned only to the initiating UI. */
  challenge: string;
  /** Set when browser hits /complete with this local nonce. */
  ready: boolean;
  /** Hub-generated handoff id, learned only from the localhost redirect. */
  hubHandoffId: string | null;
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

export type HubOAuthBegin = {
  /** Opaque id: appears in the login URL and the /complete redirect. */
  handoff: string;
  /** Secret kept by the initiating UI; never put in a URL or redirect. */
  verifier: string;
  /** base64url SHA-256 of `verifier`; safe to put in the Hub login URL. */
  challenge: string;
};

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Start a desktop login. The verifier is returned once, to the caller only. */
export function beginHubOAuthHandoff(): HubOAuthBegin {
  prune();
  const handoff = randomHandoffId();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = challengeFor(verifier);
  pendingById.set(handoff, {
    challenge,
    ready: false,
    hubHandoffId: null,
    expiresAt: Date.now() + TTL_MS,
  });
  return { handoff, verifier, challenge };
}

/**
 * Constant-time check that `verifier` belongs to this pending handoff.
 * Does not consume or alter the handoff.
 */
export function verifyHubOAuthHandoffVerifier(
  handoffId: string,
  verifier: string,
): boolean {
  prune();
  const entry = pendingById.get(handoffId.trim());
  if (!entry || entry.expiresAt <= Date.now()) return false;
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(entry.challenge);
  const b = Buffer.from(challengeFor(verifier));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Bind the Hub-generated handoff id to a local nonce after /complete.
 * Rejects unknown nonces so a phished redirect cannot mark a login ready.
 */
export function markHubOAuthHandoffReady(
  nonce: string,
  hubHandoffId: string,
): boolean {
  prune();
  const id = nonce.trim();
  const hubId = hubHandoffId.trim();
  if (!id || !hubId) return false;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(hubId)) return false;
  const entry = pendingById.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingById.delete(id);
    return false;
  }
  entry.hubHandoffId = hubId;
  entry.ready = true;
  entry.expiresAt = Date.now() + TTL_MS;
  return true;
}

/** Hub id to redeem, or null if the local nonce is not ready. */
export function hubHandoffIdFor(localId: string): string | null {
  prune();
  const entry = pendingById.get(localId.trim());
  if (!entry || entry.expiresAt <= Date.now() || !entry.ready || !entry.hubHandoffId) {
    return null;
  }
  return entry.hubHandoffId;
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
