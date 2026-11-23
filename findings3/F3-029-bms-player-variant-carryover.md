---
id: F3-029
feature: bms
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# The BMS player page keeps the previous player's variant and score cursor

## What

Open player A's profile, pick variant `7K-DT`, then navigate to player B from a leaderboard or
feed. B's page still requests `7K-DT` (and A's `scoreCursor`).

If B has no such variant, no chip is highlighted, plays read 0, and the score, session and
table lists come back empty. The page looks like B has no scores.

## Why

`variant`, `achievement` and `scoreCursor` are component state with no reset, and the router
reuses the same component for `/bms/players/$username` and `/bms/players/$username/scores`, so
state survives the param change. `selected` prefers the stored `variant` over the new
profile's `variants[0]`.

## How to improve

Remount per player with `<BmsPlayerPage key={username} ...>` in the two route components, or
add an effect that clears `variant` and `scoreCursor` when `username` changes. Check
`BmsComparePage` for the same pattern.

## Evidence

- `apps/server/public/features/bms/BmsPlayerPage.tsx:27-29` - unreset state
- `apps/server/public/features/bms/BmsPlayerPage.tsx:39-59` - selection prefers stored variant
- `apps/server/public/features/bms/BmsProfileView.tsx:205`, `:242-257` - variant plumbing
