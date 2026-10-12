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
  → pickSessionShareHighlights (PBs by PP, then non-PBs, cap 20)
  → off-screen SessionShareCard (2 columns when 9+ scores, even split)
  → modern-screenshot domToBlob (PNG)
  → navigator.clipboard.write(ClipboardItem)
       ├── ok → toast Copied
       └── fail + desktop → roxysuDesktop.writeClipboardImage
            ├── ok → toast Copied
            └── fail → toast error (no download)
```

## Business guarantee

One PNG copied to the clipboard only: absolute session date range, plays / PBs / duration, and up to twenty highlight scores with judgments and PB compare (no display name, no ruleset; never relative times). Nine or more highlights use a wider two-column even split instead of a taller card. Idle “start a session” hub cannot share. No Hub upload. No download fallback.

## Implementation references

- `apps/server/public/features/sessions/sessionShareHighlights.ts:pickSessionShareHighlights()`
- `apps/server/public/features/sessions/SessionShareCard.tsx`
- `apps/server/public/lib/sessionShareImage.ts:shareSessionImage()`
- `apps/desktop/main.js` — `roxysu:write-clipboard-image`

## Related knowledge

- [features/sessions/](../features/sessions/index.md)
