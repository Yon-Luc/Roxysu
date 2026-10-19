---
id: F-051
feature: preview-replay
kind: design-gap
severity: medium
confidence: verified
status: fixed
---

# Preview errors use a rose color on the playfield

## What

`BeatmapPreviewModal` renders load failures as `text-rose-300` centered in the dark playfield.

## Why

`knowledge/architecture/client-theme.md` says preview and replay chrome uses on-media tokens, not page-theme pastels. `text-rose-300` is neither `text-on-media` nor the danger token tuned for a scrim, so the message fights the cover.

## How to improve

| Before | After |
| --- | --- |
| `text-rose-300` paragraph | `text-on-media` or an on-media danger color, with the close control still visible |
| A single line in an otherwise empty modal | Short title, the error, and retry |

## Potential gain

A failed preview stays readable on cover art in light and dark.

## Evidence

- `apps/server/public/components/BeatmapPreviewModal.tsx` (about lines 1045–1049): `text-rose-300`.
- `knowledge/architecture/client-theme.md` rules 2–3: on-media tokens for preview chrome.

## Status

Fixed. The preview load failure in `BeatmapPreviewModal.tsx` is now a titled panel ("Preview failed to load", the error, a Retry button) on a `bg-black/55` scrim. Error copy uses the new `text-on-media-danger` token (`--color-on-media-danger` in `global.css` `@theme` only, so `html.light` does not flip it). Rule 3 and the token are recorded in `knowledge/architecture/client-theme.md`.
