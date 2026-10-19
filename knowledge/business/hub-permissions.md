---
last_verified: 2026-10
confidence: verified
touches:
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/services/hubRole.ts
  - apps/hub/src/services/clientIp.ts
  - apps/hub/src/services/hubEnv.ts
  - apps/hub/src/services/oauthState.ts
  - apps/server/src/map-analysis/calcBundle.ts
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

7. CORS is an explicit origin list in production and when `HUB_LISTEN` is a non-loopback host (published port): `CORS_ORIGIN=*` or unset refuses to listen. Otherwise unset `CORS_ORIGIN` defaults to the Roxysu client loopback origins (`http://127.0.0.1:4321`, `http://localhost:4321`); an explicit `*` is honoured only on a non-published Hub, with a boot warning.
   **Enforced by:** `apps/hub/src/services/hubEnv.ts:resolveCorsOrigin()` / `isHubPublished()` — status: verified

8. BMS score upload uses the authenticated Hub user. A body user id is ignored. The Hub computes DJ grade and combo lamp from the submitted counts and rejects autoplay. Private BMS profiles 404 for everyone except the owner. Table import is admin-only and limited to allowlisted HTTPS URLs.
   **Enforced by:** `apps/hub/src/routes/bms.ts` and `apps/hub/src/services/bms.ts:validateInbound()` — status: verified

9. Hub OAuth handoff redeem requires the handoff verifier held by the client that started login (only its SHA-256 challenge travels in URLs). Wrong verifier: 404, handoff kept, rate-limited per IP.
   **Enforced by:** `apps/hub/src/services/oauthState.ts:consumeHandoff()` — status: verified

10. Calc bundle upload from the client app targets only `resolveHubBaseUrl()`; no caller-supplied Hub URL receives the admin bearer.
   **Enforced by:** `apps/server/src/map-analysis/calcBundle.ts:uploadCalcBundleToHub()` — status: verified

**Unauthorized result:** request rejected / forbidden before mutation; Hub does not start if production CORS is unset/`*`.

## Failure behavior

Community logout is local-only (clears `localStorage`). Hub does not revoke JWTs server-side. OAuth callback redeems `h=` only (plus the client-held verifier); a JWT in the URL is ignored. Pending login handoffs are in Hub process memory.
