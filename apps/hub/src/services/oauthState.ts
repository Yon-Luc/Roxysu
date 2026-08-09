import { randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5_000;

export type OAuthClientKind = "web" | "desktop";

type StateEntry = {
  client: OAuthClientKind;
  /** Desktop handoff id from Roxysu begin — optional for web. */
  handoffId: string | null;
  expiresAt: number;
};

type HandoffEntry = {
  token: string;
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

/** Create a CSRF-bound OAuth `state` value echoed by osu!. */
export function createOAuthState(
  client: OAuthClientKind,
  handoffId?: string | null,
): string {
  pruneMap(oauthStates);
  const id = randomId();
  oauthStates.set(id, {
    client,
    handoffId: handoffId?.trim() || null,
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
 * Store a JWT under a one-time handoff id (short TTL).
 * Prefer reusing a desktop-provided id when present and unused.
 */
export function createHandoff(
  token: string,
  preferredId?: string | null,
): string {
  pruneMap(handoffs);
  const id =
    preferredId &&
    preferredId.length >= 16 &&
    preferredId.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(preferredId) &&
    !handoffs.has(preferredId)
      ? preferredId
      : randomId();
  handoffs.set(id, {
    token,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  });
  return id;
}

/** One-time redeem of a handoff JWT. */
export function consumeHandoff(id: string | undefined): string | null {
  if (!id?.trim()) return null;
  pruneMap(handoffs);
  const entry = handoffs.get(id);
  handoffs.delete(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry.token;
}

/** Test helpers. */
export function clearOAuthStateStore(): void {
  oauthStates.clear();
  handoffs.clear();
}
