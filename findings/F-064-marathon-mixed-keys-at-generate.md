---
id: F-064
feature: map-marathon
kind: logic-gap
severity: low
confidence: verified
---

# Mixed key counts are rejected only when marathon generation starts

## What

Adding sources appends any playable map until the list hits the cap. The same-key check runs inside `generate`, after the user has ordered the list.

## Why

A 4K map and a 7K map can sit together through the whole editing session. The failure is a thrown error at the end.

## How to improve

When the list already has a key count, reject an add that does not match, at the moment of add.

## Potential gain

The list the user is ordering is always a legal marathon.

## Evidence

- `apps/server/public/features/marathon/MarathonPage.tsx` (lines 194–200): append if the id is new.
- Lines 251–256: `keys.size > 1` throws only in `generate`.
