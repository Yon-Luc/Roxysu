---
id: F-031
feature: replay-video-export
kind: design-gap
severity: medium
confidence: likely
status: fixed
---

# Cancelling a video export does not tear down the encoder

## What

`exportReplayVideo` calls `output.start()` and encodes in a loop that throws on abort. There is no `finally` that cancels or finalizes the mediabunny `Output` when the throw happens before `output.finalize()`.

## Why

Abort is signaled from the UI. The encoder and its buffers then wait for garbage collection. Repeating cancel-and-export on a long map keeps those objects alive across attempts.

## How to improve

Wrap the encode loop in `try/finally`. Call the library’s cancel or close path on abort, and drop the canvas frame reference.

## Potential gain

Cancelled exports release the encoder instead of stacking until the next navigation.

## Evidence

- `apps/server/public/lib/replayVideoExport.ts` (about lines 1396–1400 and 1475–1509): `output.start()`, `throwIfAborted` inside the frame loop, `output.finalize()` only on the success path.

## Status

Fixed. `exportReplayVideo` wraps the output in `try/catch/finally`. On abort or error `teardownFailedOutput()` calls mediabunny `Output.cancel()` (releases encoders and closes the target); the `finally` clears the HUD row memo and shrinks both canvases. Streamed output goes through `createGuardedFileWritable()` so the target's close during cancel aborts the file instead of committing a truncated MP4. Tests in `lib/replayVideoExport.test.ts` use a fake output and a recording writable.
