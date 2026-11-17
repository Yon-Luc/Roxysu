---
last_verified: 2026-11
confidence: verified
touches:
  - apps/server/src
  - apps/server/src/listen.ts
  - apps/server/src/originGuard.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - README.md
---

# Client app API has no auth

## Business rules

1. The client app HTTP API (`apps/server`) does not implement user authentication or multi-user permissions.
2. Assume a single trusted operator on the client machine.

## Security rules

1. Do not expose the client app API on a network without introducing explicit auth.
   **Enforced by:** `apps/server/src/listen.ts:resolveListen()` — both entry points default to `127.0.0.1`. `ROXYSU_HOST` of `0.0.0.0`, `::`, or `localhost` is honoured and logs a warning. Mutating methods (`POST`/`PUT`/`PATCH`/`DELETE`) require an `Origin` of this process's loopback UI (`http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://[::1]:<port>`), or no `Origin` from a loopback peer. When the peer address cannot be read, a missing `Origin` is allowed only if the listen host is already loopback. — status: verified
   **Unauthorized result:** off-loopback connections are refused by the default bind; a foreign `Origin` gets HTTP 403 `{ error: "Origin not allowed" }`

**Status:** verified (absence of auth middleware + offline-first docs)
