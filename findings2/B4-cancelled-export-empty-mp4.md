---
cand: B4
feature: replay-video-export
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# A cancelled or failed streamed export leaves a 0-byte file

## Problem

Uncapped presets call `showSaveFilePicker` in the click, before audio decode. The File System Access spec creates the chosen file empty (and clears an existing file) before the picker promise resolves. `createWritable()` runs only after decode and codec probes (`replayVideoExport.ts` around the `saveHandle.createWritable()` call).

An abort or throw before that point never reaches `teardownFailedOutput`. `startExport` swallows `AbortError` and does not mention the file. `ReplayVideoSaveHandle` only has `createWritable()`.

A failure after the writable opens is a second window. `createGuardedFileWritable` turns `close()` into `abort()` so a truncated MP4 is not committed, but the picker already cleared the destination. `abort()` drops the swap file. It does not restore the previous bytes and it does not remove the empty file.

Dismissing the picker itself rejects with `AbortError` and does not create a file. That path is fine.

## Potential solution

Add an optional `remove` to the handle type and call it whenever a streamed export does not finish.

```ts
export type ReplayVideoSaveHandle = {
  createWritable(): Promise<WritableStream<StreamTargetChunk>>;
  remove?: () => Promise<void>;
};
```

`FileSystemFileHandle` in current Chromium has `remove()` on `FileSystemHandle`. Guard the call. If it is missing, the modal must say an empty file was left at the chosen name. Do not swallow that case as a silent cancel.

Call the helper from both windows:

- `startExport`'s catch, when `saveHandle` is set and the export did not return `savedToDisk`.
- `exportReplayVideo`'s catch, before rethrow, including the path that never opened a writable.

```ts
async function discardStreamedFile(handle: ReplayVideoSaveHandle | undefined) {
  if (!handle?.remove) return false;
  try {
    await handle.remove();
    return true;
  } catch {
    return false;
  }
}
```

If `remove` is absent or throws, set the export error to a fixed sentence: the chosen file was left empty. That includes cancel. A silent cancel is wrong once a file exists.

Overwrite is worse than a new file: the spec clears the existing file at confirm. `remove()` cannot bring those bytes back. The error copy should say the previous file was replaced by an empty one when the user picked an existing path. The handle does not tell us which. One sentence that covers both is enough: "Export did not finish. The chosen file is empty."

## Do not

- Do not move the picker to after decode. It has to run in the click or the browser will reject it.
- Do not `createWritable()` immediately after the picker just to hold the file. That commits a stream the encoder is not ready to fill, and the guard already exists for the later window.

## Touch

- `apps/server/public/lib/replayVideoExport.ts` — handle type, discard helper, catch in `exportReplayVideo`
- `apps/server/public/components/ScoreReplayModal.tsx` — catch in `startExport` must not treat every `AbortError` as silent when a handle exists

## Tests

Unit-test `discardStreamedFile` with a fake handle: `remove` called on abort before `createWritable`, and a missing `remove` returns false. The modal copy can be asserted by passing that false back into the error setter. Do not drive a real picker.
