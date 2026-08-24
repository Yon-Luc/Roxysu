---
last_verified: 2026-08
confidence: verified
touches:
  - packages/i18n/src/dictionary/app/{en,fr,es,pt}.json
  - apps/server/public/lib/i18n.ts
  - apps/server/public/features/overlay/OverlayPage.tsx
  - apps/server/public/features/rating-lab/RatingLabPage.tsx
  - apps/server/public/features/download/DownloadMapsPage.tsx
  - apps/server/public/features/hub
---

# Client UI i18n

## Mechanism

Client UI strings live in `packages/i18n/src/dictionary/app/{en,fr,es,pt}.json`.
Pages call `useAppDict()` (from `apps/server/public/lib/i18n.ts`) and read
`dict?.<section>?.key ?? "English fallback"`. Interpolated strings use
`t(dict?.<section>?.key, { var })`. `en.json` is the source of truth; the
other three are translations. `Dictionary["app"]` types are generated from
`en.json`, so a new key must be added there (and the other three) to type-check.

Default locale is `fr` (see `packages/i18n/src/config.ts`); the language is
chosen per-browser via `apps/server/public/lib/language.ts`.

## Coverage (top-level dictionary sections)

`nav, common, sync, dashboard, stats, practice, settings, skin, command,
session, collection, nowSelected, marathon, media, overlay, ratingLab,
download, hub`

`common` includes relative-time templates (`justNow`, `minutesAgo`,
`hoursAgo`, `daysAgo`) consumed by `formatRelativeTime(iso, dict?.common)`.

## History

Initially only nav/dashboard/stats/practice/sessions/collections/now-selected/
marathon/settings/skin were wired. The `overlay`, `ratingLab`, `download`, and
`hub` sections were added later so those pages (Overlay, Rating Lab, Download
maps, and all Community/Hub pages) render in the selected language instead of
hardcoded English.
