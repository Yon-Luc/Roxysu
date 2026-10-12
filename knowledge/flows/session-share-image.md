---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/sessions/SessionDetailPage.tsx
  - apps/server/public/features/sessions/SessionShareCard.tsx
  - apps/server/public/features/sessions/sessionShareHighlights.ts
  - apps/server/public/lib/sessionShareImage.ts
  - apps/desktop/preload.js
  - apps/desktop/main.js
---

# Share session as image

## User intent

Copy a branded session summary image to the clipboard so it can be pasted into chat (Discord, etc.).

## Flow

```text
SessionDetailPage (active session)
  → Copy as image
  → shareSessionImage arms navigator.clipboard.write(ClipboardItem + deferred PNG promise)
       (must run in the click turn — Chromium user activation)
  → prepareCard: optional fetchSession(limit=500) + pickSessionShareHighlights
  → off-screen SessionShareCard → modern-screenshot domToBlob → deliver blob
       ├── clipboard write ok → toast Copied
       ├── else desktop writeClipboardImage → toast Copied
       └── else downloadBlob → toast Downloaded
```

## Business guarantee

One PNG: prefer clipboard copy (deferred ClipboardItem so capture can finish after the click). Absolute session date range, plays / PBs / duration, up to twenty highlight scores with judgments and PB compare. Nine or more highlights use a wider two-column even split. Idle hub cannot share. Download only if clipboard and Electron bridge both fail.

## Implementation references

- `apps/server/public/features/sessions/sessionShareHighlights.ts:pickSessionShareHighlights()`
- `apps/server/public/features/sessions/SessionShareCard.tsx`
- `apps/server/public/lib/sessionShareImage.ts:shareSessionImage()`
- `apps/desktop/main.js` — `roxysu:write-clipboard-image`

## Related knowledge

- [features/sessions/](../features/sessions/index.md)
