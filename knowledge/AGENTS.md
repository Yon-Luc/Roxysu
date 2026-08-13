# Agent Instructions

1. Read `knowledge/.state` — bootstrap or incremental mode?
2. Read [vocabulary.md](vocabulary.md) — use canonical terms only.
3. Start at `knowledge/index.md`.
4. For feature tasks, read the relevant feature index before touching code.
5. For architectural changes, read `knowledge/decisions/` first.
6. For end-to-end behavior, consult `knowledge/flows/`.
7. For features with access control (Hub), read `## Security rules` before making changes.
8. Always run the pre-change impact checklist from `.cursor/rules/knowledge-maintainer.mdc`.
9. Business rules: authoritative when `verified` or `inferred`.
10. Security rules: authoritative only when `verified`.
11. Refresh `last_verified` in any document you confirm is still accurate.

## Repo entry points

| Concern | Start here |
|---|---|
| Client app API + UI | `apps/server/` |
| Realm extraction | `apps/realm-reader/` |
| Shared schema | `packages/db/` |
| Hub | `apps/hub/` |
| Desktop shell | `apps/desktop/` |
| Canonical architecture notes | `docs/architecture.md` |
