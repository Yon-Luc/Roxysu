---
id: F3-026
feature: hub
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# A public GET increments a collection's download count

## What

`GET /collections/:id/export` bumps `downloadCount` on every unauthenticated read. Anyone can
inflate any collection's number, limited only to 30/min per IP, and browser prefetch or a
retry inflates it unintentionally.

## Why

The counter write sits inside the read handler instead of a Save-specific endpoint. The
limiter slows it down; it does not make the read idempotent.

## How to improve

Remove the counter write from `GET /collections/:id/export` and make export a pure read. Add
an authenticated `POST /collections/:id/download`, idempotent per user per day, that
increments it.

## Evidence

- `apps/hub/src/routes/collections.ts:370-389` - counter write inside the GET
- `apps/hub/src/routes/collections.ts:374` - per-IP limiter
