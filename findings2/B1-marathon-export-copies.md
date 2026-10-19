---
cand: B1
reopens: F-034
feature: map-marathon
kind: perf
severity: medium
confidence: verified
status: proposed
---

# Marathon export peaks at several copies of the WAV

## Problem

F-034 removed the float32 copy. The pack path still stacks buffers in the browser tab:

1. `mixTracksToWav` keeps every PCM16 chunk alive.
2. `assembleStereoWav` allocates a second buffer of `44 + dataSize` and copies into it.
3. `zipSync(files)` deflates at fflate's default level (6). That holds the WAV, the deflate output, and the final archive, and it runs synchronously.
4. `new Blob([zipped])` copies the archive again.

A marathon at the 60-minute cap is about 635 MB of PCM. Two PCM copies are already about 1.27 GB, before deflate. The tab freezes for the pack.

## Potential solution

PCM does not compress. Store it. Do not assemble a second WAV.

Use fflate `Zip` + `ZipPassThrough` (already the `fflate` dependency; `ZipPassThrough` is store, not deflate). Push the 44-byte header, then each PCM chunk, and drop that chunk before the next push. Collect the zip callback's output parts and return `new Blob(parts)`. A Blob of parts does not concatenate them into one `Uint8Array`.

```ts
const parts: Uint8Array[] = [];
const zip = new Zip((err, chunk) => {
  if (err) throw err;
  if (chunk.length) parts.push(chunk);
});
const audio = new ZipPassThrough(encoded.filename);
zip.add(audio);
audio.push(wavHeader, false);
for (const chunk of chunks) {
  audio.push(chunk, false);
}
chunks.length = 0;
audio.push(new Uint8Array(0), true);
// .osu text and background are small; ZipDeflate or another ZipPassThrough is fine
zip.end();
return { blob: new Blob(parts), filename, audioName };
```

Keep `assembleStereoWav` only if a test still wants a WAV byte buffer. The export path should not call it.

Leave `MARATHON_MAX_DURATION_SEC` at 60 minutes. A lower cap is a product change, not required once the extra copies and the synchronous deflate are gone.

## Do not

- Do not only pass `{ level: 0 }` to `zipSync` and keep `assembleStereoWav`. That still holds chunks + WAV + archive.
- Do not move the pack to a worker in this change. Store streaming already takes the freeze off the tab. A worker is a later option if the zip container itself is still too heavy.

## Touch

- `apps/server/public/lib/marathonExport.ts` — `mixTracksToWav` return, `buildMarathonArchive` pack

## Tests

Existing marathon export tests should still see a valid `.osz` whose audio entry starts with `RIFF` and whose PCM payload matches the chunks. Add one assertion that the packed audio entry is stored (compression method 0), so a later edit cannot put deflate back on the WAV.
