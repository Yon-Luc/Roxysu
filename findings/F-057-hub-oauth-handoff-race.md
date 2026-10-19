---
id: F-057
feature: hub
kind: security
severity: medium
confidence: likely
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
