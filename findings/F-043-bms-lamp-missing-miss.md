---
id: F-043
feature: bms
kind: logic-gap
severity: medium
confidence: likely
---

# Combo lamp treats a missing miss count as zero

## What

`comboLamp` uses `j.miss ?? 0` (and the same for bad and poor) after only requiring that one of pgreat, great, or good is present. A score whose statistics omit `miss` can receive FC, perfect, or max.

## Why

Lamp rules are “no bad, poor, or miss”. A missing key is not evidence of zero. Local profiles, table completion, and Hub uploads all go through `interpretBmsScore`, so the overstated lamp is stored and shared.

## How to improve

If bad, poor, or miss is null, return a null lamp. Assign FC only when those keys are present and zero.

## Potential gain

Fewer false full-combo and perfect badges when Realm statistics are partial.

## Evidence

- `packages/db/src/bmsInterpret.ts` `comboLamp` (lines 181–194): null miss becomes 0; the early null return ignores miss.
