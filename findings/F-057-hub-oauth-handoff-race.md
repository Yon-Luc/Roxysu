---
id: F-057
feature: hub
kind: security
severity: medium
confidence: likely
status: fixed
---

# Hub OAuth handoff is redeemed by the first caller who knows the id

## What

After login, Hub stores a one-time JWT under a handoff id. The client app polls `GET /api/system/hub-oauth/pending?h=…` with no auth and asks Hub `GET /auth/handoff/:id`. The first successful redeem consumes the token.

## Why

The id travels in the redirect. Another local process that sees the URL, or a caller who wins the poll, receives the Community JWT. Hub rate-limits by IP (30 per minute) and does not bind the handoff to the Roxysu process.

## How to improve

Bind the handoff to a short-lived cookie set on the localhost redirect, or require a second value that only the desktop shell stored before opening the browser.

## Potential gain

A Community session cannot be taken by whichever process polls the handoff id first.

## Evidence

- `apps/server/src/routes/system.ts` (about lines 126–156): pending route fetches `/auth/handoff/:id` and returns `{ token }`.
- `apps/hub/src/routes/auth.ts` (about lines 185–201): `consumeHandoff(params.id)` after an IP rate limit.

## Status

Fixed (PKCE-style handoff verifier). The client that starts login keeps a high-entropy verifier and sends only its SHA-256 challenge in the Hub login URL (`GET /auth/login?challenge=…`, now required). The Hub stores the challenge with the one-time JWT; `GET /auth/handoff/:id` is replaced by `POST /auth/handoff/:id` with `{ verifier }`, compared in constant time. A wrong verifier returns the same 404, does not consume the handoff, and counts toward the 30/min per-IP limit. Desktop: `POST /api/system/hub-oauth/begin` returns `{ handoff, verifier, challenge }`; `POST /hub-oauth/pending` checks the verifier locally and forwards it to the Hub. Web: verifier lives in `sessionStorage` (same tab) and the login link is now a button. Files: `apps/hub/src/services/oauthState.ts`, `routes/auth.ts`, `apps/server/src/hubOAuthPending.ts`, `routes/system.ts`, `public/lib/hub.ts`, `HubLoginButton.tsx`. Tests: `security.test.ts`, `routes/auth.handoff.test.ts`, `hubOAuthPending.test.ts`. Remaining: the challenge is visible in URLs but cannot derive the verifier; a process that can read the initiating UI's memory or the same-tab `sessionStorage` is still inside the trust boundary.
