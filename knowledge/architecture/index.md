# Architecture

System structure and tech choices for Roxysu.

## Documents

| Doc | Purpose |
|---|---|
| [process-model.md](process-model.md) | Realm → SQLite → server → UI |
| [tech-stack.md](tech-stack.md) | Runtimes and libraries |
| [data-ownership.md](data-ownership.md) | Which process writes which tables |
| [hub-vs-local.md](hub-vs-local.md) | Local app vs online hub |

## Guiding principles

1. Local-first practice data stays on the machine.
2. `client.realm` is read-only except manual `!Roxysu` collection sync.
3. SQLite is the bus between processes — no private IPC protocol.
4. Analytics and search live in `apps/server/src/` until a second consumer needs them extracted.
