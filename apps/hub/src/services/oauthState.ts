import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5_000;

export type OAuthClientKind = "web" | "desktop";

type StateEntry = {
  client: OAuthClientKind;
  /**
   * Desktop local nonce from Roxysu begin. Not the Hub handoff id.
   * Echoed on the localhost redirect so only that pending login learns the id.
   */
  nonce: string | null;
  /** Handoff challenge: base64url SHA-256 of the initiating client's verifier. */
  challenge: string;
  expiresAt: number;
};

type HandoffEntry = {
  token: string;
  /** base64url SHA-256 of the verifier required to redeem. */
  challenge: string;
  expiresAt: number;
};

const oauthStates = new Map<string, StateEntry>();
const handoffs = new Map<string, HandoffEntry>();

function pruneMap<T extends { expiresAt: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.expiresAt <= now) map.delete(key);
  }
  if (map.size <= MAX_ENTRIES) return;
  // Drop oldest-ish by iterating insertion order.
  const overflow = map.size - MAX_ENTRIES;
  let i = 0;
  for (const key of map.keys()) {
    map.delete(key);
    i += 1;
    if (i >= overflow) break;
  }
}

function randomId(): string {
  return randomBytes(24).toString("base64url");
}

/** base64url SHA-256 is always 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

export function isValidHandoffChallenge(value: string | undefined | null): value is string {
  return typeof value === "string" && CHALLENGE_RE.test(value);
}

export function isValidHandoffVerifier(value: string | undefined | null): value is string {
  return typeof value === "string" && VERIFIER_RE.test(value);
}

/** Challenge a client sends at login for a verifier it keeps private. */
export function handoffChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function challengeMatches(storedChallenge: string, verifier: string): boolean {
  const a = Buffer.from(storedChallenge);
  const b = Buffer.from(handoffChallengeFor(verifier));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Create a CSRF-bound OAuth `state` value echoed by osu!; carries the handoff challenge. */
export function createOAuthState(
  client: OAuthClientKind,
  nonce: string | null | undefined,
  challenge: string,
): string {
  if (!isValidHandoffChallenge(challenge)) {
    throw new Error("Invalid handoff challenge");
  }
  pruneMap(oauthStates);
  const id = randomId();
  oauthStates.set(id, {
    client,
    nonce: nonce?.trim() || null,
    challenge,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  return id;
}

/** One-time consume of OAuth state. Returns null if missing/expired. */
export function consumeOAuthState(state: string | undefined): StateEntry | null {
  if (!state?.trim()) return null;
  pruneMap(oauthStates);
  const entry = oauthStates.get(state);
  oauthStates.delete(state);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

/**
 * Store a JWT under a Hub-generated handoff id (short TTL).
 * Callers cannot choose the id. A query-string id would let the sender of a
 * login link redeem the victim's JWT with a challenge they also chose.
 */
export function createHandoff(token: string, challenge: string): string {
  if (!isValidHandoffChallenge(challenge)) {
    throw new Error("Invalid handoff challenge");
  }
  pruneMap(handoffs);
  const id = randomId();
  handoffs.set(id, {
    token,
    challenge,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  });
  return id;
}

/**
 * One-time redeem of a handoff JWT. Requires the verifier whose SHA-256 was
 * registered at login. A wrong or malformed verifier returns null and does
 * NOT consume the handoff, so a third party that learned the id cannot burn
 * it; the caller still counts the attempt toward the rate limit.
 */
export function consumeHandoff(
  id: string | undefined,
  verifier: string | undefined,
): string | null {
  if (!id?.trim()) return null;
  pruneMap(handoffs);
  const entry = handoffs.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    handoffs.delete(id);
    return null;
  }
  if (!isValidHandoffVerifier(verifier)) return null;
  if (!challengeMatches(entry.challenge, verifier)) return null;
  handoffs.delete(id);
  return entry.token;
}

/** Test helpers. */
export function clearOAuthStateStore(): void {
  oauthStates.clear();
  handoffs.clear();
}
