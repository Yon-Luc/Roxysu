import { randomBytes } from "node:crypto";
import { isHubProduction } from "./hubEnv";

const WEAK_SECRETS = new Set([
  "",
  "dev-secret-change-me",
  "change-me",
  "change-me-to-a-long-random-secret",
  "secret",
  "jwt-secret",
]);

const MIN_SECRET_LENGTH = 32;

let cachedSecret: string | null = null;

function isWeakSecret(raw: string): boolean {
  if (WEAK_SECRETS.has(raw)) return true;
  if (raw.length < MIN_SECRET_LENGTH) return true;
  const lower = raw.toLowerCase();
  if (lower.startsWith("change-me") || lower.startsWith("dev-secret")) {
    return true;
  }
  return false;
}

/**
 * Resolve the hub JWT signing secret.
 * Production always fails closed. Local/dev may opt into an ephemeral secret
 * via HUB_ALLOW_INSECURE_JWT=1 (never use in production).
 */
export function resolveJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const raw = process.env.JWT_SECRET?.trim() ?? "";
  const insecureOk =
    !isHubProduction() && process.env.HUB_ALLOW_INSECURE_JWT === "1";

  if (raw && !isWeakSecret(raw)) {
    cachedSecret = raw;
    return cachedSecret;
  }

  if (isHubProduction()) {
    throw new Error(
      "[hub] JWT_SECRET is missing or too weak. Set a random secret (≥32 chars).",
    );
  }

  if (!insecureOk) {
    throw new Error(
      "[hub] JWT_SECRET is missing or too weak (≥32 chars, not a placeholder). " +
        "Set JWT_SECRET, or for local-only boot set HUB_ALLOW_INSECURE_JWT=1.",
    );
  }

  cachedSecret = randomBytes(32).toString("base64url");
  console.warn(
    "[hub] HUB_ALLOW_INSECURE_JWT=1 — using ephemeral JWT secret for this process only.",
  );
  return cachedSecret;
}

/** Test helper. */
export function clearCachedJwtSecret(): void {
  cachedSecret = null;
}
