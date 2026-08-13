---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src
  - README.md
---

# Local API has no auth

## Business rules

1. The local product HTTP API (`apps/server`) does not implement user authentication or multi-user permissions.
2. Assume a single trusted operator on localhost / desktop.

## Security rules

1. Do not add networked exposure of the local API without introducing explicit auth.
   **Enforced by:** product design / deployment assumption — status: verified
   **Unauthorized result:** N/A today (local-only)

**Status:** verified (absence of auth middleware + local-first docs)
