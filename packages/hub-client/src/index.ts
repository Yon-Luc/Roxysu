import { treaty } from "@elysiajs/eden";
import type { App } from "@roxysu/hub";

/**
 * Typed Eden Treaty client for Node / scripts.
 * The Workshop UI cannot import this (it would pull the Hub process into the
 * browser bundle). Browser calls go through `apps/server/public/lib/hub.ts`.
 */
export function createHubClient(baseUrl: string, jwtToken?: string) {
  return treaty<App>(baseUrl, {
    headers: jwtToken
      ? { Authorization: `Bearer ${jwtToken}` }
      : undefined,
  });
}

export type HubClient = ReturnType<typeof createHubClient>;
