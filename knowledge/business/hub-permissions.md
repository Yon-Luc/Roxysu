---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/services/hubRole.ts
  - apps/hub/src/services/clientIp.ts
  - apps/hub/src/routes
  - roxysu-hub-plan.md
---

# Hub permissions

## Security rules

1. JWT required for authenticated Hub routes. Role is re-read from the Hub store, not taken from the JWT claim.
   **Enforced by:** `apps/hub/src/middleware/auth.ts` — status: verified

2. Edit collection: owner or admin — status: verified

3. Delete collection: owner or admin — status: verified

4. Hub search index admin APIs: admin role — status: verified

5. `ADMIN_OSU_ID` promotes that osu! id to admin on login. An existing admin row is not demoted if the env var is unset or points at someone else.
   **Enforced by:** `apps/hub/src/services/hubRole.ts:resolveHubLoginRole()` — status: verified

6. Rate limits do not trust forwarded client IPs unless `HUB_TRUST_PROXY=1` (then `X-Real-Ip`, else last `X-Forwarded-For` hop).
   **Enforced by:** `apps/hub/src/services/clientIp.ts` — status: verified

**Unauthorized result:** request rejected / forbidden before mutation.
