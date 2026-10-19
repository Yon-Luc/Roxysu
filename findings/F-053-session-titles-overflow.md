---
id: F-053
feature: sessions
kind: design-gap
severity: medium
confidence: verified
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
