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
   **Enforced by:** `apps/server/src/listen.ts:resolveListen()` — both entry points default to `127.0.0.1`. `ROXYSU_HOST=localhost` resolves to `127.0.0.1` (Bun can otherwise bind every interface); `0.0.0.0` and `::` are honoured and log a warning. Mutating methods (`POST`/`PUT`/`PATCH`/`DELETE`) require an `Origin` of this process's loopback UI (`http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://[::1]:<port>`), or no `Origin` from a loopback peer. When the peer address cannot be read, a missing `Origin` is allowed only if the listen host is already loopback. — status: verified
   **Unauthorized result:** off-loopback connections are refused by the default bind; a foreign `Origin` gets HTTP 403 `{ error: "Origin not allowed" }`

2. Settings-supplied executable paths are validated before they reach a spawn. Rating Lab calculator paths must resolve inside `maniaRatingAllowedRoots()` (documented `dist/`, `tools/mania-rating-calc`, `~/roxysu-calc`, app data/resource dirs, or `ROXYSU_CALCULATOR_ROOTS`), both on PATCH and at spawn time; the user-chosen tosu binary must be a runnable regular file and cannot be world-writable or inside `os.tmpdir()`. A relative path, NUL/newline, directory, device node, dangling link, or out-of-root path is rejected.
   **Enforced by:** `apps/server/src/executablePath.ts:assertSafeExecutablePath()`, `apps/server/src/mania-rating/allowedRoots.ts`, `PATCH /api/settings`, `runCalculator()` — status: verified
   **Unauthorized result:** HTTP 400 with the validator error; no spawn.

**Status:** verified (absence of auth middleware + offline-first docs)
