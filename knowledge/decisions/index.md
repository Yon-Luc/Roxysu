# Architectural decisions

Constraints agents must not accidentally violate. Terms: [vocabulary.md](../vocabulary.md).

| Decision | Path |
|---|---|
| Dual runtime + local mirror bus | [dual-runtime-sqlite-bus.md](dual-runtime-sqlite-bus.md) |
| No IPC between processes | [no-ipc-between-processes.md](no-ipc-between-processes.md) |
| Poll for imports, not Realm listeners | [poll-not-realm-listeners.md](poll-not-realm-listeners.md) |
| Keep analytics in server | [keep-analytics-in-server.md](keep-analytics-in-server.md) |
| Hub is a separate process | [hub-separate-process.md](hub-separate-process.md) |
