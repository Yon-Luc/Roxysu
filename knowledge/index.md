# Roxysu Knowledge Map

Local-first practice analytics for osu!lazer. Source of truth for **how** is the code; this tree answers **what, why, and where**.

## Navigate

| Area | Path | Answers |
|---|---|---|
| Architecture | [architecture/](architecture/index.md) | Process model, stack, data ownership |
| Features | [features/](features/index.md) | What product surfaces exist |
| Business rules | [business/](business/index.md) | Cross-cutting constraints |
| Flows | [flows/](flows/index.md) | End-to-end user/system paths |
| Decisions | [decisions/](decisions/index.md) | Constraints agents must not violate |

## Apps & packages (quick map)

| Path | Role |
|---|---|
| `apps/server` | Bun + Elysia API, analytics, SSE, React UI (`:4321`) |
| `apps/realm-reader` | Node + Realm JS → SQLite mirror; collection write-back |
| `apps/hub` | Online hub API (`:4322`) — share collections, search cache |
| `apps/desktop` | Electron shell spawning server + realm-reader |
| `packages/db` | Shared Drizzle schema + dual SQLite clients |
| `packages/osu-paths` | Lazer path resolution |
| `packages/collection-sync` | `!Roxysu` prefix + sync wire types |
| `packages/realm-backup` | `client.realm` backup helpers |
| `packages/sunny-dan` | Mania Sunny/Daniel difficulty estimates |
| `packages/osu-chart`, `mania-judge`, `mania-pattern-analysis`, `pattern-7k`, `timing-analysis` | Chart/analysis libraries |
| `packages/i18n`, `hub-client` | i18n + typed hub client |

## Bootstrap note

Initial knowledge seeded 2026-08 from README, `docs/architecture.md`, and source. Grow incrementally; prefer `unknown` over guesses.
