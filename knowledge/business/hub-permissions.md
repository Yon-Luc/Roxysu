---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/routes
  - roxysu-hub-plan.md
---

# Hub permissions

## Security rules

1. JWT required for authenticated Hub routes.
   **Enforced by:** `apps/hub/src/middleware/auth.ts` — status: verified

2. Update collection: owner only — status: verified

3. Delete collection: owner or admin — status: verified

4. Search-cache admin APIs: admin role — status: verified

**Unauthorized result:** request rejected / forbidden before mutation.
