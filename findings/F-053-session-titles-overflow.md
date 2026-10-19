---
id: F-053
feature: sessions
kind: design-gap
severity: medium
confidence: verified
status: fixed
---

# Long session names overflow the list and the detail header

## What

Session list titles are `font-semibold` inside `min-w-0` and are not truncated. The detail header puts `session.name` in `PageTitle` inside a wrapping flex row, also without truncation.

## Why

Generated names and long custom names run into the play count and the live chip, and they widen narrow rows. The column already has `min-w-0`, which only clips if the title itself truncates.

## How to improve

| Before | After |
| --- | --- |
| Full `s.name` in the list row | `truncate` and `title={s.name}` |
| `PageTitle` grows with the name | `min-w-0` and `truncate` or `line-clamp-2` beside the share and live actions |

## Potential gain

The session list stays one row per session on a phone-width window.

## Evidence

- `apps/server/public/features/sessions/SessionsPage.tsx` (lines 184–186).
- `apps/server/public/features/sessions/SessionDetailPage.tsx` (lines 315–318).
- `apps/server/public/global.css` `.rx-title` (about lines 420–425): 1.75rem, weight 800, no overflow rule.

## Status

Fixed. `SessionsPage.tsx`: list title and the open-session subtitle use `truncate`, the title carries `title={s.name}`. `SessionDetailPage.tsx`: the header `PageTitle` gets `line-clamp-2 min-w-0 break-words` and `title={session.name}`; `PageTitle` accepts an optional `title` prop. On a narrow window the title item has `min-w-0`, so inside the wrapping flex row it is clamped to the container width (the Copy as image button wraps below) instead of widening the page. No color tokens changed, so `knowledge/architecture/client-theme.md` needs no edit. Knowledge: `features/sessions/` rule 22. Not browser-verified.
