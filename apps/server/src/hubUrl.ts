export const DEFAULT_HUB_URL = "http://localhost:4322";

/** Hub base URL used by Workshop, OAuth redeem, and Download Maps search-index lookup. */
export function resolveHubBaseUrl(
  raw: string | undefined = process.env.HUB_URL,
): string {
  return (raw?.trim() || DEFAULT_HUB_URL).replace(/\/$/, "");
}
