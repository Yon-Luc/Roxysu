# Song Select & Preview

## Goal

Build song selection on top of the existing Roxysu beatmap catalog.

## Data Source

Use:

```text
beatmap_sets
beatmaps
mastery
scores
collections
tags
beatmap_mania_ratings
beatmap_pattern_analysis
```

## Song Select Repository

Provide high-level operations:

```text
search
sort
filter
get set
get difficulties
get user statistics
```

Do not query SQLite directly from UI components.

## Filters

Potential filters:

- ruleset
- difficulty
- star rating
- mapper
- title
- artist
- tags
- collection
- mastery
- pattern
- BPM
- length

## Display

Song Select can combine existing data:

```text
metadata
+ mania rating
+ pattern analysis
+ mastery
+ personal best
```

without recomputing analysis.

## Preview

```text
SongSelect
   ↓
PreviewController
   ↓
AudioEngine
```

Preview state must be independent of gameplay state.

Use `previewTime` from the beatmap metadata where available.

## Loading

Song Select should primarily read metadata. Do not parse every `.osu` file just to display the list.

## Deliverable

A searchable catalog where selecting a difficulty can transition into the loading/gameplay pipeline.
