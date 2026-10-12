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
  → optional fetchSession(limit=500) when UI window incomplete
  → pickSessionShareHighlights (PBs by PP, then non-PBs, cap 8)
  → off-screen SessionShareCard
  → modern-screenshot domToBlob (PNG)
  → navigator.clipboard.write(ClipboardItem)
       ├── ok → toast Copied
       └── fail + desktop → roxysuDesktop.writeClipboardImage
            ├── ok → toast Copied
            └── fail → downloadBlob + toast Downloaded
```

## Business guarantee

One PNG only: absolute session date range + ruleset, plays / PBs / duration, and up to eight highlight scores (no display name; never relative times). Always dark branded card (not page theme). Idle “start a session” hub cannot share. No Hub upload.

## Implementation references

- `apps/server/public/features/sessions/sessionShareHighlights.ts:pickSessionShareHighlights()`
- `apps/server/public/features/sessions/SessionShareCard.tsx`
- `apps/server/public/lib/sessionShareImage.ts:shareSessionImage()`
- `apps/desktop/main.js` — `roxysu:write-clipboard-image`

## Related knowledge

- [features/sessions/](../features/sessions/index.md)
