---
cand: D4
feature: desktop
kind: perf
severity: low
confidence: verified
status: proposed
---

# Child log file descriptors leak on every respawn

## Problem

`openChildLogFd` opens an append fd and pushes it onto `childLogFds`. `stdio: [..., fd, fd]` shares that parent fd. Node does not take ownership of it. `closeChildLogs` runs only from `shutdown()`. Nothing closes the fd on `'exit'`.

Callers: packaged or `.js` node children (`spawnNodeEntry`) and every overlay spawn. Dev `.ts` realm uses `stdio: "inherit"` and does not open a log fd.

Realm respawns are capped at 6 short runs. Overlay liveness (15 s gap) and URL-change respawns are not capped. A crash-looping overlay that exits with a code (not a signal — see D1) opens a new fd each time. The "240 fds an hour" figure assumes that loop and a 15 s gap. It is an estimate, not a measured run. Reaching the soft limit makes `fs.openSync` throw inside `apply()`, which has no catch.

After D1, signal crashes respawn too, so they join this leak. Land D4 with D1.

## Potential solution

Reuse one fd per label. The parent fd stays valid after the child exits. The next spawn can pass the same number.

```js
const childLogFdByLabel = new Map();

function openChildLogFd(dataDir, label) {
  const logPath = path.join(dataDir, "logs", `${label}.log`);
  let fd = childLogFdByLabel.get(label);
  if (fd == null) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fd = fs.openSync(logPath, "a");
    childLogFdByLabel.set(label, fd);
  }
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} starting ${label} ---\n`);
  return { logPath, fd };
}
```

`closeChildLogs` closes the map values and clears it. Drop the array, or keep it as a mirror of the map. One close path.

Do not close the fd in the child's `'exit'` handler if the next spawn reuses it. Closing and reopening also fixes the leak, and is worse: a respawn can race the close. Reuse is the smaller change.

## Do not

- Do not cap overlay respawns to hide the leak. The HUD should come back. The fd should not.
- Do not open the log with `fs.createWriteStream` and forget to end it. Same leak, harder to see.

## Touch

- `apps/desktop/main.js` — `openChildLogFd`, `closeChildLogs`

## Tests

Optional. A unit test of the helper with a fake `fs` is more harness than the bug is worth. Manual check: two calls with the same label return the same fd and write two separator lines. Say that in the commit if no test is added.
