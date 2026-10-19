---
id: F-014
feature: smart-collections
kind: correctness
severity: medium
confidence: verified
---

# Collection write-back copies Realm after opening it for write

## What

`runCollectionSync` opens `client.realm` read/write, checks the schema version, then calls `backupRealmFile`, which is `copyFileSync` of the live file. The backup is taken after the write connection exists, not before.

## Why

The product rule is that `client.realm` is copied before write-back. A copy of a file that Realm already has open can be a torn snapshot if lazer or the OS is also writing it. Restore of that backup is not a clean pre-write image.

## How to improve

Copy the Realm file before `openRealmForWrite`. Keep the existing “lazer must be closed” check so the copy is idle.

## Potential gain

The five kept backups are actually restorable if write-back fails mid-transaction.

## Evidence

- `apps/realm-reader/src/syncCollections.ts` `runCollectionSync` (lines 112–116): `openRealmForWrite`, then `assertSchemaVersion`, then `backupRealmFile`.
- `packages/realm-backup/src/index.ts` `backupRealmFile` uses `copyFileSync`.
