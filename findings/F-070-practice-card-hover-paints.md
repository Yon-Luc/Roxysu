---
id: F-070
feature: practice-library
kind: perf
severity: low
confidence: verified
---

# Practice cards animate shadow and background on hover

## What

`.rx-card:hover` transitions `background`, `box-shadow`, and `transform`. Practice and collection grids use `rx-card` on every cover.

## Why

`transform` can stay on the compositor. Background and box-shadow repaint the card, including the cover image, on every hover in a dense grid.

## How to improve

| Before | After |
| --- | --- |
| Hover transitions background, shadow, and `translateY(-2px)` | Hover a ring or an opacity overlay. Leave background and shadow alone on grid cards |
| The same hover on touch | `@media (hover: hover)` so a tapped card does not stick in the hovered paint |

## Potential gain

Scrolling and hovering a large practice grid does less paint work.

## Evidence

- `apps/server/public/global.css` (about lines 388–404): `.rx-card` transition and `:hover` shadow.
- `apps/server/public/features/practice/PracticeListPage.tsx` (about line 552): `className="rx-card flex flex-col"`.
