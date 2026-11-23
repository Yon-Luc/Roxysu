---
id: F3-041
feature: preview-replay
kind: security
severity: medium
confidence: verified
status: proposed
---

# `.osk` import inflates the whole archive with no size budget

## What

`unzipSkinArchive` calls `unzipSync(data)` and only then sanitises names and filters empty
entries.

A malicious or simply enormous `.osk` - a zip bomb, or a skin packing a large video - inflates
every entry into a fresh `Uint8Array` on the main thread before any filtering. Dragging it onto
the Skin page or the preview modal freezes and then crashes the tab. Nothing persists, but the
user loses unsaved UI state.

## Why

There is no declared-size or aggregate check before `unzipSync`; fflate allocates each entry
from the zip header's size. The same code appears in all three importers. The replay path has
exactly this guard in `decompressReplayBounded`; skin import has none.

## How to improve

Follow the replay pattern with a shared helper, for example
`unzipSkinArchive(data, { maxEntryBytes: 16 MiB, maxTotalBytes: 128 MiB })`, implemented with
fflate's streaming `Unzip` or by pre-checking central-directory sizes via `unzipSync({ filter })`.

Reject the archive with a visible message - never silently skip entries, or the user gets a
broken skin instead of an error.

Run F-033's path sanitiser inside the filter so unsafe names are never inflated.

## Evidence

- `apps/server/public/lib/maniaSkinImport.ts:72-84`
- `apps/server/public/lib/stdSkinImport.ts:100-101`
- `apps/server/public/lib/catchSkinImport.ts:51-52`
- `apps/server/src/replay/decode.ts:76-117` - the guarded equivalent

## Notes

F-033 fixed entry *names* only.
