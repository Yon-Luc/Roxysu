---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/global.css
  - apps/server/public/lib/theme.ts
  - apps/server/public/lib/chartStyles.ts
  - apps/server/public/features/settings/sections/AppearanceSection.tsx
  - apps/server/public/components/BeatmapPreviewEmbed.tsx
---

# Client app theme tokens

## Purpose

Keep client app text readable in both dark and light appearance. Tokens live in `apps/server/public/global.css`; appearance is chosen in Settings (`roxysu:theme`).

## Business rules

1. Page chrome (canvas, sidebar, panels) uses `ink` / `subtle` / `muted` / `faint` for copy. **Not:** Tailwind pastels such as `text-rose-300` or `text-amber-200` — those fail contrast on the light canvas.
2. Status copy uses `danger` / `warning` / `success` / `info`. Light appearance uses darker hues so the same class stays readable.
3. Beatmap preview, score rewatch, and embedded preview sit on a dark overlay over cover art. That chrome uses `on-media` / `on-media-muted` and does **not** follow `ink`. **Not:** `text-ink` on `bg-black/*` overlays. The Now selected embed (`.rx-preview-embed*`) uses a lighter scrim under `html.light` so the playfield stays visible; controls keep a denser bar plus text-shadow.
4. Charts use `useChartStyles()` so ticks, grid, and tooltips follow the resolved appearance. **Not:** hardcoded `#fff` tooltip text or `rgba(255,255,255,…)` grids.
5. The OBS overlay page is always dark with `overlay-text` shadows — it does not use page tokens.

## Implementation

`html.light` flips canvas/ink/status hues. `--color-on-media` is defined only in `@theme` so it stays near-white in both appearances. `.rx-preview-embed*` scrim/controls opacities are lighter under `html.light`.

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
