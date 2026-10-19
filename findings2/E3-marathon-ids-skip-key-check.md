---
cand: E3
reopens: F-064
feature: map-marathon
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Opening Marathon from `?ids=` skips the key-count check

## Problem

`addIds` and `fillRecommend` run `partitionByKeyCount` and toast the rejected maps. The `initialIds` effect does not. It sets tracks to every playable source:

```ts
setTracks(data.sources.filter(isPlayableSource));
```

The sources route does not filter either. Mixed keys come back as `keyCount: null` plus the full list. The page then takes the display key count from the first track, so the other key counts stay in the list.

## Potential solution

Use the same partition as `fillRecommend`, which also starts from an empty list.

```ts
const playable = data.sources.filter(isPlayableSource);
const { accepted, rejected, referenceKeyCount } = partitionByKeyCount([], playable);
setTracks(accepted);
rejectKeyMismatch(rejected, referenceKeyCount);
if (referenceKeyCount) setRecKey(referenceKeyCount === 4 ? 4 : 7);
```

`rejectKeyMismatch` is already in the component. Do not add a second toast.

If every source is rejected, tracks stay empty and the toast explains why. That is better than a mixed list.

## Do not

- Do not filter only in the URL parser. The check belongs next to the other two call sites, on the sources the server returned.
- Do not drop the server's mixed-key response. Other callers may want the full list. The page decides.

## Touch

- `apps/server/public/features/marathon/MarathonPage.tsx` — the `initialIds` effect

## Tests

A page test, or a direct call of the effect's then-handler if the partition is extracted. Fixture: ids that resolve to one 4K source and one 7K source. Tracks contain only the first key count. `rejectKeyMismatch` is called with the other. An all-matching list still sets every track.
