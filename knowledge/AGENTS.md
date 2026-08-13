# Agent Instructions

1. Read `knowledge/.state` — bootstrap or incremental mode?
2. Start at `knowledge/index.md`.
3. For feature tasks, read the relevant feature index before touching code.
4. For architectural changes, read `knowledge/decisions/` first.
5. For end-to-end behavior, consult `knowledge/flows/`.
6. For features with access control (Hub), read `## Security rules` before making changes.
7. Always run the pre-change impact checklist from `.cursor/rules/knowledge-maintainer.mdc`.
8. Business rules: authoritative when `verified` or `inferred`.
9. Security rules: authoritative only when `verified`.
10. Update `last_verified` in any document you confirm is still accurate.

## Repo entry points

| Concern | Start here |
|---|---|
| Local API + UI | `apps/server/` |
| Realm → SQLite import | `apps/realm-reader/` |
| Shared schema | `packages/db/` |
| Hub (online share) | `apps/hub/` |
| Desktop shell | `apps/desktop/` |
| Canonical architecture notes | `docs/architecture.md` |
