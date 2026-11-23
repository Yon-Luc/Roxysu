---
id: F3-036
feature: tosu-live
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# "Start tosu" is a one-shot button per page lifetime

## What

Both live panels hide the Start button on `startMut.isSuccess`, which stays true for the
mutation's lifetime. The POST resolves as soon as the spawn was attempted; tosu usually needs
several seconds to answer.

A failed start - crash, wrong path - leaves the panel with no retry control until the page is
reloaded.

## Why

The render gate is `!startMut.isSuccess`. `useMutation` success state is not reset, and the
response returns the pre-connect snapshot.

## How to improve

Gate on the snapshot only (`data.status !== "connected"`), and call `startMut.reset()` in the
panel's live-tick effect, or re-show the button after a timeout.

## Evidence

- `apps/server/public/features/now-selected/NowSelectedPage.tsx:364-378`
- `apps/server/public/features/sessions/SessionTosuLivePanel.tsx:285-300`, `:158-165`
