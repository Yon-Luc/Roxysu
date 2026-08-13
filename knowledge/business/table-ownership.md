---
last_verified: 2026-08
confidence: verified
touches:
  - packages/db/src/schema.ts
  - docs/architecture.md
---

# Table ownership

## Business rules

1. realm-reader writes raw import tables only.
2. server writes derived analytics and user-authored tables only.
3. Queries filter `delete_pending` / soft-deleted import rows out of product views.

**Status:** verified
