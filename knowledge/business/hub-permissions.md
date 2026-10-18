---
last_verified: 2026-10
confidence: verified
touches:
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/services/hubRole.ts
  - apps/hub/src/services/clientIp.ts
  - apps/hub/src/services/hubEnv.ts
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

4b. Hub calc bundle admin upload/list/delete: admin role — status: verified
   **Enforced by:** `apps/hub/src/routes/admin.ts` `/admin/calc-bundles*` + `requireAdmin`

5. `ADMIN_OSU_ID` promotes that osu! id to admin on login. An existing admin row is not demoted if the env var is unset or points at someone else.
   **Enforced by:** `apps/hub/src/services/hubRole.ts:resolveHubLoginRole()` — status: verified

6. Rate limits do not trust forwarded client IPs unless `HUB_TRUST_PROXY=1` (then `X-Real-Ip`, else last `X-Forwarded-For` hop).
   **Enforced by:** `apps/hub/src/services/clientIp.ts` — status: verified

7. Production CORS is an explicit origin list. `CORS_ORIGIN=*` or unset refuses to listen.
   **Enforced by:** `apps/hub/src/services/hubEnv.ts:resolveCorsOrigin()` — status: verified

8. BMS score upload uses the authenticated Hub user. A body user id is ignored. Private BMS profiles 404 for everyone except the owner. Table import is admin-only and limited to allowlisted HTTPS URLs.
   **Enforced by:** `apps/hub/src/routes/bms.ts` — status: verified

**Unauthorized result:** request rejected / forbidden before mutation; Hub does not start if production CORS is unset/`*`.

## Failure behavior

Community logout is local-only (clears `localStorage`). Hub does not revoke JWTs server-side. OAuth callback redeems `h=` only; a JWT in the URL is ignored.
