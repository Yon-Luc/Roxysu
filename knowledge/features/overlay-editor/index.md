---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/overlay/profiles.ts
  - apps/server/src/routes/overlay.ts
  - packages/db/src/settings-keys.ts
  - apps/server/public/features/overlay
  - apps/server/public/features/overlay-editor
  - apps/server/public/components/BeatmapPreviewEmbed.tsx
  - apps/server/public/router.tsx
  - packages/i18n/src/dictionary/app
---

# Overlay editor

## Purpose

Compose the `/overlay` HUD: an editor page (`/overlay-editor`) where the user
places **Overlay elements** by dragging, sizes the render surface, saves named
**Overlay profiles**, and gates element visibility with **Overlay triggers**
evaluated against **tosu live**.

## Business rules

1. Profiles persist in the Settings HTTP store (local mirror `settings` table,
   key `overlay.profiles` as a JSON array) — **not** page-local storage. The
   OBS browser source and the Wayland In-game overlay host have isolated
   storage; the local mirror is the only shared persistence.
2. Consumers select a profile via `#/overlay?profile=<id or name>`. A missing
   profile renders nothing. No `profile` param keeps the legacy rendering:
   one natural-width score list (`bg=clear|solid`, `limit=N`) — back-compat
   for existing OBS / Wayland URLs.
3. Element types (Extended set): `scoreList`, `identity`, `difficulty`,
   `livePlay`, `preview`, `analysis`, `sessionStats`, `personalStats`,
   `density`. Server-side sanitization drops unknown types and clamps
   coordinates, scale (0.25–4), size (320–7680), score-list limit (1–25).
4. Overlay triggers are simple per-element conditions on the tosu live
   snapshot (`play.active`, `status`, `connected`; op is/isNot; action
   hide/show/fade). `fade` keeps layout space at 0.25 opacity; no nesting.
   Triggers never gate data fetching — only rendering.
5. The preview embed pauses while `play.active` (same rule as Now selected)
   so in-game audio is not doubled. Preview/density elements are opt-in per
   element instance.
6. The editor page (`/overlay-editor`) lives under the root route — it renders
   **without AppShell chrome**. The canvas shows the profile at its real pixel
   size (1:1); a Fit view toggle scales it to the viewport instead.
7. Editor chrome (toolbar / palette / layers / inspector) is hidden by default
   and revealed when the cursor touches a screen edge (~36px) or hovers a
   layer; clicking empty canvas deselects elements (elements stop propagation;
   hidden-by-trigger placeholders are selectable too).
8. The preview element renders gameplay only: `BeatmapPreviewEmbed` accepts
   `showControls` (default true) and the overlay passes false to hide the
   seek/timing bar.

## Main flows

```
editor page → PUT /api/overlay/profiles/:id → settings.overlay.profiles
consumer URL (#/overlay?profile=name) → GET /api/overlay?profile=name → profile + payload
tosu live snapshot (SSE / useTosuLiveQuery) → trigger evaluation → hide/show/fade
```

## Important symbols

- `apps/server/src/overlay/profiles.ts` — types, sanitize, read/write, resolve
- `apps/server/src/routes/overlay.ts` — `GET/PUT/DELETE /api/overlay/profiles`, `?profile=` on `GET /`
- `apps/server/public/features/overlay/profileModel.ts` — element catalog, clamps, trigger evaluation
- `apps/server/public/features/overlay/OverlayStage.tsx` — fixed-size stage, fit-scale, positioning
- `apps/server/public/features/overlay/OverlayElements.tsx` — element renderers
- `apps/server/public/features/overlay-editor/OverlayEditorPage.tsx` — editor page

## Dependencies

- [tosu-live/](tosu-live/index.md) — snapshot for identity/difficulty/livePlay/analysis/triggers
- [preview-replay/](preview-replay/index.md) — embedded playfield (`BeatmapPreviewEmbed`)
- dashboard's `/api/overlay` payload (session/recent scores) — same endpoint extended

## Depended on by

- [in-game-overlay/](in-game-overlay/index.md) — Wayland host consumes `?profile=` URLs

## Related knowledge

- [vocabulary.md](../vocabulary.md) — Overlay profile / element / trigger
- [features/in-game-overlay/](in-game-overlay/index.md)
- [features/now-selected/](now-selected/index.md) — widget layout precedent (page-local, deliberately *not* reused here)
