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

This links against `osu.Game` and `osu.Game.Rulesets.Mania` from the checkout.

**NixOS:** Roxysu spawns the calculator as a subprocess outside your dev shell, so publish **self-contained** (bundles the .NET runtime):

```bash
cd tools/mania-rating-calc

OSU_GAME_PATH=~/dev/osu-enissay dotnet publish -c Release \
  --self-contained -r linux-x64 \
  -o ~/roxysu-calc/enissay-accuracy-change
```

Settings path stays the same: `~/roxysu-calc/enissay-accuracy-change/mania-rating-calc`.

### Parallel backfill

By default the backfill job runs **4 calculator processes at once**. Override with:

```bash
MANIA_RATING_CONCURRENCY=8 bun run ...
```

Self-contained .NET + osu.Game is memory-heavy — keep concurrency modest if the machine starts swapping.

## Configure Roxysu
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
5. **Export CSV** for spreadsheet analysis, or **Export HTML** for a shareable self-contained analysis page

### Export HTML

**Export HTML** downloads `rating-lab-analyse.html` — one file with CSS, vanilla JS, and the full compare snapshot inlined (no attributes payloads). Open it in any browser:

- Summary cards, SR-delta histogram, and top movers (recomputed as you filter)
- Name search and **keymode** filter (All / 4K / 7K / …)
- Sortable, paginated table (same columns as Rating Lab)
- Beatmap **osu!** links and cover images from the osu! CDN via `setOnlineId` / `onlineId` (covers need network; table/stats work offline)

Same query params as CSV for versions: `GET /api/rating-lab/export-html?q=…&baseline=…&experiment=…`

## Adding a new formula version

### Recommended: new version id (keep old cache)

Use a **new** `versionId` whenever the algo changes so old cached rows stay available for side-by-side comparison.

1. **Get the new code** in your osu checkout:

   ```bash
   cd ~/dev/osu-enissay   # or wherever your Natelytle/osu clone lives
   git fetch
   git checkout <new-branch-or-commit>
   ```

2. **Build a new self-contained binary** (NixOS) with a new version id and output dir:

   ```bash
   cd ~/dev/side/Roxysu
   nix develop   # so dotnet is available

   cd tools/mania-rating-calc
   OSU_GAME_PATH=~/dev/osu-enissay dotnet publish -c Release \
     --self-contained -r linux-x64 \
     -p:VersionId=enissay-accuracy-v2 \
     -o ~/roxysu-calc/enissay-accuracy-v2
   ```

3. **Smoke-test** the binary:

   ```bash
   ~/roxysu-calc/enissay-accuracy-v2/mania-rating-calc \
     --mods NM --version-id enissay-accuracy-v2 \
     /path/to/some/mania.osu
   ```

4. **Register it** in `apps/server/src/mania-rating/registry.ts`:

   ```typescript
   registerVersion({
     id: "enissay-accuracy-v2",
     label: "Enissay accuracy v2",
     description: "…",
     gitRef: "Natelytle/osu <branch>@<sha>",
     source: "computed",
   });
   ```

   Optionally point `ENISSAY_ACCURACY_VERSION` / the Rating Lab default experiment at the new id.

5. **Settings → Mania Rating Lab** — set the executable for `enissay-accuracy-v2` to:

   `~/roxysu-calc/enissay-accuracy-v2/mania-rating-calc`

   (stored as `maniaRating.executable.enissay-accuracy-v2`)

6. **Rating Lab** — pick experiment = new version, then **Compute missing experiment** for your query. Old `enissay-accuracy-change` rows remain usable for comparison.

### Shortcut: overwrite the same version

Only if you do not need to keep old results under the previous id:

1. Checkout the new commit and rebuild into the **same** output path (e.g. `~/roxysu-calc/enissay-accuracy-change`).
2. No registry change if the id stays `enissay-accuracy-change`.
3. Delete stale cache for that version (or use **Force rerun experiment**), then **Compute missing experiment** if anything is still blank.

Cache key is `(beatmap_id, version_id)` — same id + a valid cache row is skipped unless the row is missing, failed, or the beatmap hash changed.

### Optional

- Refresh C# snapshots under `tools/mania-rating-calc/docs/` if you want in-repo diffs.
- Update `.branch-enissay.json` / the version `gitRef` to the new pin.

**Rule of thumb:** new algo iteration → **new `versionId` + new binary path**. Do not reuse the old id if you still want side-by-side comparison.

## Reference snapshots

C# reference files from master and enissay branches live in `tools/mania-rating-calc/docs/` for diff review — they are not compiled.
