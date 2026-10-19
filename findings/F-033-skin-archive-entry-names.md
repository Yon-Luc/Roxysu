---
id: F-033
feature: preview-replay
kind: security
severity: medium
confidence: verified
status: fixed
---

# Skin archive entry names are copied from Realm filenames

## What

`GET /api/skins/:id/archive` uses each Realm file’s `filename` as the zip entry name. The client importer only strips a leading slash. Neither side rejects `..` segments.

## Why

The bytes themselves come from content-addressed lazer hashes, so this does not read arbitrary disk paths. The archive entry name is still attacker-controlled if Realm metadata is hostile or corrupt. Unzipping that `.osk` with a naive extractor can write outside the destination directory.

## How to improve

Store only a normalized relative path: reject `..`, drive prefixes, and absolute paths on both the zip writer and `unzipSkinArchive`.

## Potential gain

A skin export cannot carry a zip-slip name into osu! or an unzip tool.

## Evidence

- `apps/server/src/routes/skins.ts` (lines 75–82): `zipEntries[file.filename] = ...`.
- `apps/server/public/lib/maniaSkinImport.ts` `normalizePath` (lines 63–77): `replace(/^\/+/, "")` only.

## Status

Fixed. New pure `apps/server/src/shared/zipEntryPath.ts:sanitizeZipEntryPath()` (rejects `..`, absolute, drive prefix, NUL, empty; normalizes `\` and `.`/empty segments). `routes/skins.ts` skips unsafe Realm filenames when building the archive; the mania, standard, and catch `unzipSkinArchive()` in `public/lib/*SkinImport.ts` skip unsafe entries on read (client imports it via the `@server/` alias). Tests: `shared/zipEntryPath.test.ts`, `public/lib/maniaSkinImport.test.ts`. `apps/play` SkinLoader has a separate unzip not changed.
