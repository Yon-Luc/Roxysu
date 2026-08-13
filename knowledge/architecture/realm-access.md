---
last_verified: 2026-08
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - docs/architecture.md
  - README.md
---

# Realm access

## Purpose

Define how Roxysu reads and (rarely) writes osu!lazer's Realm file.

## Business meaning

`client.realm` is osu!'s store — Roxysu treats it as read-only except for manual **collection write-back**. Schema stability is not guaranteed; extraction code must tolerate lazer changes.

## Business rules

1. Normal operation: read-only extraction into the local mirror.
2. Only exception: collection write-back to `!Roxysu `-prefixed `BeatmapCollection` rows (manual, gated, backed up).
3. Do not use Realm change listeners — poll/watermark extraction instead (lazer may exclusive-lock the file).

## Related knowledge

- [vocabulary.md](../vocabulary.md)
- [business/realm-read-only.md](../business/realm-read-only.md)
- [decisions/poll-not-realm-listeners.md](../decisions/poll-not-realm-listeners.md)
