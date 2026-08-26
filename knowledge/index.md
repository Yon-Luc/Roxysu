# Roxysu Knowledge Map

Offline-first practice analytics for osu!lazer. Source of truth for **how** is the code; this tree answers **what, why, and where**.

## Navigate

| Area | Path | Answers |
|---|---|---|
| **Vocabulary** | [vocabulary.md](vocabulary.md) | Canonical terms — read before writing |
| Architecture | [architecture/](architecture/index.md) | Process model, stack, table ownership |
| Features | [features/](features/index.md) | What product surfaces exist |
| Business rules | [business/](business/index.md) | Cross-cutting constraints |
| Flows | [flows/](flows/index.md) | End-to-end user/system paths |
| Decisions | [decisions/](decisions/index.md) | Constraints agents must not violate |

## Apps & packages (quick map)

| Path | Role |
|---|---|
| `apps/server` | Client app API, analytics, SSE, React UI (`:4321`) |
| `apps/realm-reader` | Node + Realm JS → local mirror; collection write-back |
| `apps/hub` | Hub API (`:4322`) — share collections, hub search index |
| `apps/desktop` | Electron shell spawning server + realm-reader |
| `packages/db` | Shared Drizzle schema + dual SQLite clients |
| `packages/osu-paths` | Lazer path resolution |
| `packages/collection-sync` | `!Roxysu` prefix + write-back wire types |
| `packages/realm-backup` | `client.realm` backup helpers |
| `packages/sunny-dan` | Mania Sunny/Daniel difficulty estimates |
| `packages/osu-chart`, `mania-judge`, `mania-pattern-analysis`, `pattern-7k`, `timing-analysis` | Chart/analysis libraries |
| `packages/i18n`, `hub-client` | i18n + typed hub client |
| `apps/tosu-counter` | Standalone mania notefield **Tosu counter** (no client app needed) |

## Bootstrap note

Initial knowledge seeded 2026-08 from README, `docs/architecture.md`, and source. Grow incrementally; prefer `unknown` over guesses. Use [vocabulary.md](vocabulary.md) for all domain terms.
