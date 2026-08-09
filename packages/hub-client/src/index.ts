import { treaty } from "@elysiajs/eden";
import type { App } from "@roxysu/hub";

/**
 * Create a typed Eden Treaty client pointed at the hub API.
 *
 * Usage:
 *   import { createHubClient } from "@roxysu/hub-client"
 *   const hub = createHubClient("http://localhost:4322")
 *
 *   // Fully typed — autocomplete on every route
 *   const { data, error } = await hub.collections.get({ query: { tag: "7k" } })
 *   const { data, error } = await hub.collections({ id: 1 }).export.get()
 *
 * With auth:
 *   const hub = createHubClient(url, token)
 *   const { data } = await hub.collections.post({ ... })
 */
export function createHubClient(baseUrl: string, jwtToken?: string) {
  return treaty<App>(baseUrl, {
    headers: jwtToken
      ? { Authorization: `Bearer ${jwtToken}` }
      : undefined,
  });
}

export type HubClient = ReturnType<typeof createHubClient>;
