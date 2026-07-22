# Mania Rating Lab

Compare experimental mania star rating and SS PP formulas against lazer baseline inside Roxysu.

## Overview

Roxysu imports official lazer `star_rating` from Realm. Rating Lab recomputes SR and theoretical max PP (100% accuracy, NM) from local `.osu` files using versioned calculator binaries built from osu!lazer branches.

## Build calculator binaries

You need a local [osu!lazer](https://github.com/ppy/osu) checkout (or fork such as [Natelytle/osu](https://github.com/Natelytle/osu)).

### 1. Master baseline (`lazer-master`)

```bash
git clone https://github.com/ppy/osu.git
cd osu
git checkout master

# Copy Roxysu CLI into the solution (one-time)
cp -r /path/to/Roxysu/tools/mania-rating-calc ./mania-rating-calc
dotnet sln add mania-rating-calc/ManiaRatingCalc.csproj

dotnet publish mania-rating-calc/ManiaRatingCalc.csproj -c Release \
  -o /path/to/Roxysu/dist/lazer-master
```

### 2. Enissay rework (`enissay-accuracy-change`)

```bash
cd osu
git fetch origin
git checkout mania/enissay-mania-sr-rework-accuracy-change

dotnet publish mania-rating-calc/ManiaRatingCalc.csproj -c Release \
  -p:VersionId=enissay-accuracy-change \
  -o /path/to/Roxysu/dist/enissay-accuracy-change
```

Or build from Natelytle's fork directly:

```bash
git clone https://github.com/Natelytle/osu.git
cd osu
git checkout mania/enissay-mania-sr-rework-accuracy-change
# ... same publish steps
```

### Alternative: OSU_GAME_PATH

From Roxysu's `tools/mania-rating-calc/`:

```bash
OSU_GAME_PATH=/path/to/osu dotnet publish -c Release -o dist/my-build
```

## Configure Roxysu

1. Open **Settings → Mania Rating Lab**
2. Set executable paths:
   - **Lazer master** → `dist/lazer-master/mania-rating-calc`
   - **Enissay accuracy change** → `dist/enissay-accuracy-change/mania-rating-calc`
3. Ensure **osu! data path** points at your lazer install (for `.osu` file hashes)

## CLI contract

```bash
mania-rating-calc --mods NM --version-id enissay-accuracy-change /path/to/map.osu
```

Stdout JSON:

```json
{
  "version": "enissay-accuracy-change",
  "starRating": 7.42,
  "starRatingSs": 8.11,
  "ppSs": 412.5,
  "attributes": { "speed_difficulty": 3.2, "variety": 1.05 }
}
```

## Using Rating Lab

Open **Rating Lab** (`#/rating-lab`):

1. Enter a query, e.g. `mode:mania key=7 ranked`
2. Pick **baseline** (usually `lazer-master`) and **experiment** (e.g. `enissay-accuracy-change`)
3. View SR / PP deltas in the table and histogram
4. Run **backfill** to compute missing ratings in bulk
5. **Export CSV** for spreadsheet analysis

## Adding a new formula version

1. Build a new binary from your branch/commit
2. Register in `apps/server/src/mania-rating/registry.ts`:
   ```typescript
   registerVersion({
     id: "my-iteration-2026-08",
     label: "My iteration Aug 2026",
     description: "...",
     gitRef: "my-branch@abc1234",
   });
   ```
3. Set its executable path in Settings (key: `maniaRating.executable.my-iteration-2026-08`)
4. Old versions and cached rows remain available for comparison

## Reference snapshots

C# reference files from master and enissay branches live in `tools/mania-rating-calc/docs/` for diff review — they are not compiled.
