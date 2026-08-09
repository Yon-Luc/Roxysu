/** In-memory one-shot hub JWT handoff for Electron system-browser OAuth. */

const TTL_MS = 5 * 60 * 1000;

type Pending = {
  token: string;
  expiresAt: number;
};

let pending: Pending | null = null;

export function setPendingHubOAuthToken(token: string): void {
  const trimmed = token.trim();
  if (!trimmed) return;
  pending = { token: trimmed, expiresAt: Date.now() + TTL_MS };
}

/** Returns and clears a non-expired pending token, or null. */
export function takePendingHubOAuthToken(): string | null {
  if (!pending) return null;
  const { token, expiresAt } = pending;
  pending = null;
  if (Date.now() > expiresAt) return null;
  return token;
}

/** Test helper. */
export function clearPendingHubOAuthToken(): void {
  pending = null;
}
