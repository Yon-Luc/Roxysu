---
id: F-060
feature: hub
kind: security
severity: medium
confidence: verified
status: fixed
---

# Non-production Hub defaults CORS to every origin

## What

`resolveCorsOrigin` throws if production is configured with `*` or an empty list. Outside production, an empty `CORS_ORIGIN` returns `"*"`. The Hub app passes that straight to the CORS plugin.

## Why

A Hub process published on a port without `HUB_ENV=production` accepts browser reads from any site. The bearer is still required for authenticated routes. A token that a malicious page can see (pasted, or sitting in a page that talks to Hub) is usable from that origin. Production already forbids this.

## How to improve

Default development to `http://127.0.0.1:4321` only. Treat a published port like production: require an explicit origin list.

## Potential gain

A dev or preview Hub does not answer every website.

## Evidence

- `apps/hub/src/services/hubEnv.ts` `resolveCorsOrigin` (lines 16–36): production rejects `*`; otherwise empty parts return `"*"`.
- `apps/hub/src/index.ts` (about lines 28–35): `cors({ origin: corsOrigin })`.

## Status

Fixed. `resolveCorsOrigin` (`apps/hub/src/services/hubEnv.ts`) now defaults an unset `CORS_ORIGIN` to the Roxysu client loopback origins (`http://127.0.0.1:4321`, `http://localhost:4321`). New optional `HUB_LISTEN` (applied in `apps/hub/src/index.ts`): a non-loopback value counts as a published port and, like production, rejects `*` and unset `CORS_ORIGIN` at boot. An explicit `*` on a non-published dev Hub is still honoured but logs a warning. Tests in `hubEnv.test.ts`; `.env.example` and knowledge (hub rule 7, `business/hub-permissions.md` rule 7, `architecture/hub-vs-local.md`) updated.
