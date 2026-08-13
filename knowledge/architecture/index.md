# Architecture

System structure and tech choices for Roxysu.

## Documents

| Doc | Purpose |
|---|---|
| [process-model.md](process-model.md) | Realm → local mirror → client app → UI |
| [tech-stack.md](tech-stack.md) | Runtimes and libraries |
| [local-mirror.md](local-mirror.md) | Roxysu's SQLite store |
| [realm-access.md](realm-access.md) | How Roxysu reads/writes Realm |
| [data-ownership.md](data-ownership.md) | Which process writes which tables |
| [hub-vs-local.md](hub-vs-local.md) | Client app vs Hub |

## Guiding principles

1. Practice beatmaps and scores stay on the client machine (offline-capable).
2. Realm is read-only except manual `!Roxysu` collection write-back.
3. The local mirror is the bus between processes — no private IPC protocol.
4. Analytics and search live in `apps/server/src/` until a second consumer needs them extracted.

## Vocabulary

All terms: [vocabulary.md](../vocabulary.md).
