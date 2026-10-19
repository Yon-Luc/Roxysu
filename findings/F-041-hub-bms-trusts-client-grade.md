---
id: F-041
feature: bms
kind: security
severity: medium
confidence: verified
status: fixed
---

# Hub stores client DJ grade and combo lamp without checking judgements

## What

`validateInbound` checks numeric ranges and known variant and gauge ids. It does not check that `djGrade` and `comboLampId` match the judgements and accuracy in the same payload. `ingestBmsScore` writes those fields through.

## Why

Local derive uses `interpretBmsScore`. Hub trust is documented as `community_submitted`, so the server does not re-derive. A client can still send a grade or lamp that contradicts its own judgement counts, and leaderboards and table completion will use the stored values.

## How to improve

On ingest, run the shared interpreter from judgements, accuracy, and mods. Overwrite or reject the row when the submitted grade or lamp disagrees.

## Potential gain

Public grades and lamps follow the same rules as the local profile, including for a client that is not Roxysu.

## Evidence

- `apps/hub/src/services/bms.ts` `validateInbound` (about lines 86–118): no grade or lamp enum check against judgements.
- Insert (about lines 225–229): `comboLampId` and `djGrade` copied from `score.gameplay`.
- `knowledge/features/bms/index.md` security rule 2: trust is `community_submitted`.

## Status

Fixed. Verified against the code on 2026-10-19: Hub ingest computes grade and combo lamp from judgement counts with `bmsScorePresentation`, ignoring client values (`apps/hub/src/services/bms.ts`, `bms.ingest.test.ts`).
