---
id: F-056
feature: hub
kind: security
severity: medium
confidence: verified
status: fixed
---

# Calc-bundle upload posts the admin token to whatever Hub URL the body names

## What

`POST /api/settings/calc-bundle/export-upload` uses `body.hubUrl` when it is non-empty, otherwise the configured Hub base. It sends `Authorization: Bearer ${token}` to `${hubUrl}/admin/calc-bundles`. The token is the one in the request body.

## Why

The client app has no user auth (`knowledge/business/local-no-auth.md`) and binds localhost by default, so this is not a remote open proxy in the default install. Any local caller can still aim the upload at a host that is not the configured Hub. A mistyped URL, or a page that can call localhost, receives the admin bearer the operator just supplied.

## How to improve

Upload only to `resolveHubBaseUrl()`. If a custom URL stays, require an explicit confirm and refuse non-HTTPS and link-local targets.

## Potential gain

An admin token used for a calc-bundle upload cannot be sent to an arbitrary host by changing one field.

## Evidence

- `apps/server/src/routes/settings.ts` (about lines 263–289): `hubUrl: body.hubUrl?.trim() || resolveHubBaseUrl()`.
- `apps/server/src/map-analysis/calcBundle.ts` `uploadCalcBundleToHub` (lines 554–566): `fetch(\`${hubUrl}/admin/calc-bundles\`)` with the bearer.

## Status

Fixed. `uploadCalcBundleToHub` (`apps/server/src/map-analysis/calcBundle.ts`) no longer takes a `hubUrl`; it always posts to `resolveHubBaseUrl()`. The `hubUrl` field is removed from the `POST /calc-bundle/export-upload` body schema (`apps/server/src/routes/settings.ts`), `exportUploadCalcBundle` (`public/lib/api.ts`) and the admin page caller. Test in `calcBundle.test.ts` shows a caller-supplied URL is never used. Knowledge: hub feature rule 19, `business/hub-permissions.md` rule 10, `flows/hub-calc-bundle-pull.md`.
