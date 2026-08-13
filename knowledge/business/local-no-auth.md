---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src
  - README.md
---

# Client app API has no auth

## Business rules

1. The client app HTTP API (`apps/server`) does not implement user authentication or multi-user permissions.
2. Assume a single trusted operator on the client machine.

## Security rules

1. Do not expose the client app API on a network without introducing explicit auth.
   **Enforced by:** product design / deployment assumption — status: verified
   **Unauthorized result:** N/A today (offline-capable client app)

**Status:** verified (absence of auth middleware + offline-first docs)
