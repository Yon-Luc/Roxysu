---
id: F-063
feature: map-marathon
kind: logic-gap
severity: low
confidence: verified
---

# Marathon export can be aborted in code and cannot be aborted from the page

## What

`generateMarathonOsz` throws `AbortError` when its signal aborts. `MarathonPage` never creates an `AbortController` and never passes `signal`.

## Why

Audio decode of up to twelve maps has no cancel path. The mutation’s abort handling is dead. The user reloads the page to stop a run.

## How to improve

Own an `AbortController` in the page, pass `signal` into `generateMarathonOsz`, and add a Cancel control that aborts it.

## Potential gain

A long or mistaken marathon can be stopped without reloading.

## Evidence

- `apps/server/public/features/marathon/MarathonPage.tsx` (lines 257–268): `generateMarathonOsz({ ... })` with no `signal`.
- `apps/server/public/lib/marathonExport.ts` `throwIfAborted` (lines 145–148).
