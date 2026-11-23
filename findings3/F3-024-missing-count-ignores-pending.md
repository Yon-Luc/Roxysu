---
id: F3-024
feature: download-mirrors
kind: correctness
severity: low
confidence: verified
status: proposed
---

# The "N maps missing" count ignores pending downloads

## What

The count preview subtracts only library-owned sets, while download-all hides owned and
pending. After a batch download the count still advertises hundreds of missing maps that the
next download-all silently skips.

## Why

`countMatchingOnlineBeatmapsets` uses the fast path `total_count - countOwnedSetsMatchingMirrorParams`,
which never reads `pendingDownloads`. `collectMatchingOnlineBeatmapsets` hides
`owned` union `pending` via `loadIdsToHideFromDownloadSearch`.

## How to improve

Subtract pending ids that match the mirror params in the fast path too, or fall back to
`collectMatchingOnlineBeatmapsets` whenever the pending store is non-empty. The first keeps
the fast path for the common case.

## Evidence

- `apps/server/src/mirrors/searchOnline.ts:713-746` - owned-only subtraction
- `apps/server/src/mirrors/searchOnline.ts:507-510` - hide set is owned union pending
- `apps/server/src/mirrors/pendingDownloads.ts:108-119` - the pending store
