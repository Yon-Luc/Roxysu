---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/practice/PracticeListPage.tsx
  - apps/server/public/features/collections/CollectionResultsPage.tsx
  - apps/server/public/global.css
  - apps/server/public/lib/theme.ts
  - apps/server/public/lib/chartStyles.ts
  - apps/server/public/features/settings/sections/AppearanceSection.tsx
  - apps/server/public/components/BeatmapPreviewEmbed.tsx
  - apps/server/public/components/BeatmapPreviewModal.tsx
---

# Client app theme tokens

## Purpose

Keep client app text readable in both dark and light appearance. Tokens live in `apps/server/public/global.css`; appearance is chosen in Settings (`roxysu:theme`).

## Business rules

1. Page chrome (canvas, sidebar, panels) uses `ink` / `subtle` / `muted` / `faint` for copy. **Not:** Tailwind pastels such as `text-rose-300` or `text-amber-200` — those fail contrast on the light canvas.
2. Status copy uses `danger` / `warning` / `success` / `info`. Light appearance uses darker hues so the same class stays readable.
3. Beatmap preview, score rewatch, and embedded preview sit on a dark overlay over cover art. That chrome uses `on-media` / `on-media-muted` and does **not** follow `ink`. **Not:** `text-ink` on `bg-black/*` overlays. The Now selected embed (`.rx-preview-embed*`) uses a lighter scrim under `html.light` so the playfield stays visible; controls keep a denser bar plus text-shadow.
4. Charts use `useChartStyles()` so ticks, grid, and tooltips follow the resolved appearance. **Not:** hardcoded `#fff` tooltip text or `rgba(255,255,255,…)` grids.
3a. Error copy on that dark chrome (for example a failed preview load) uses `on-media-danger` (`text-on-media-danger`), a pastel that stays readable on the scrim in both appearances. **Not:** `text-danger` (flips to a dark hue under `html.light`) and **not** raw Tailwind pastels such as `text-rose-300`. Put the message on a `bg-black/*` panel so it stays legible over bright cover art.
5. The OBS overlay page is always dark with `overlay-text` shadows — it does not use page tokens.
6. Hover paint on cards applies only under `@media (hover: hover)`. Dense grid cards add `rx-card-grid` next to `rx-card`: hover animates only `transform` and `opacity` (accent ring and tint on `::after`) so the cover image is not repainted. **Not:** `background` or `box-shadow` transitions on grid cards.

## Implementation

`html.light` flips canvas/ink/status hues. `--color-on-media` and `--color-on-media-danger` are defined only in `@theme` so it stays near-white in both appearances. `.rx-preview-embed*` scrim/controls opacities are lighter under `html.light`.

Tailwind maps `--color-*` to utilities (`text-ink`, `text-danger`, `bg-warning/15`, `text-on-media`).

## Important symbols

- `apps/server/public/global.css` — token definitions + `.rx-preview-embed*`
- `apps/server/public/lib/theme.ts` — `applyTheme()`, `html.light` class
- `apps/server/public/lib/chartStyles.ts` — `useChartStyles()`
- `apps/server/public/features/settings/sections/AppearanceSection.tsx`
- `apps/server/public/components/BeatmapPreviewEmbed.tsx`

## Depended on by

- All client app pages under `apps/server/public/`
- `features/preview-replay/` — media chrome
- `features/now-selected/` — embedded preview

## Related knowledge

- [tech-stack.md](tech-stack.md)
- [features/preview-replay/index.md](../features/preview-replay/index.md)
- [features/now-selected/index.md](../features/now-selected/index.md)
