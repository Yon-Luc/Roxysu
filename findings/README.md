# Findings

Read-only audit of the working tree on 2026-10-19. One note per issue. Each note has what, why, how to improve, potential gain, and the code that supports it.

Severity is user-facing cost, not how large the patch would be. `likely` means the code path is real and the user impact still depends on timing or a compositor.

Intentionally not written up: localhost client API with no auth (`knowledge/business/local-no-auth.md`), Hub as its own process, analytics staying in the server, and poll-based Realm import. Those are decisions. A tosu host that is not loopback is a setting, not an SSRF bug.

## High

| Id | Feature | Kind | Title |
| --- | --- | --- | --- |
| [F-001](F-001-stall-skips-orphan-deletes.md) | live-sync | correctness | Reconcile stall skips orphan deletes |
| [F-002](F-002-analytics-during-running-import.md) | live-sync | correctness | Analytics rebuilds while an import is still running |
| [F-003](F-003-pb-ignores-estimated-mania-pp.md) | sessions | correctness | Personal best uses raw PP while mastery uses estimated mania PP |
| [F-004](F-004-realm-writes-not-exclusive.md) | smart-collections | correctness | Realm writes are not exclusive, and the extraction pause is not counted |
| [F-005](F-005-replay-lzma-unbounded.md) | preview-replay | security | Replay decode does not cap decompressed size |
| [F-006](F-006-tosu-spawn-stacks-processes.md) | tosu-live | correctness | Tosu auto-start can stack detached processes |
| [F-007](F-007-desktop-quit-does-not-wait.md) | desktop | correctness | Desktop quit does not wait for child processes |
| [F-008](F-008-bms-false-empty-while-loading.md) | bms | design-gap | BMS profile says there are no scores while the request is in flight |

## Medium

| Id | Feature | Kind | Title |
| --- | --- | --- | --- |
| [F-009](F-009-full-reconcile-not-transactional.md) | live-sync | correctness | Full and reconcile extraction commit outside one import transaction |
| [F-010](F-010-soft-delete-count-gate.md) | live-sync | logic-gap | Soft-delete and hidden flags heal only when counts differ |
| [F-011](F-011-stale-running-import.md) | live-sync | logic-gap | A stale running import is cleared only when realm-reader starts |
| [F-012](F-012-mirror-foreign-keys-off.md) | live-sync | design-gap | The local mirror does not enforce foreign keys |
| [F-013](F-013-incremental-sync-materializes-delta.md) | live-sync | perf | Incremental sync loads the whole watermark delta into memory |
| [F-014](F-014-realm-backup-after-open.md) | smart-collections | correctness | Collection write-back copies Realm after opening it for write |
| [F-015](F-015-stats-cache-ignores-customize.md) | stats | logic-gap | Stats cache ignores Customize changes |
| [F-016](F-016-stats-summary-ignores-scope.md) | stats | logic-gap | Stats summary counts sessions and PBs outside the score scope |
| [F-017](F-017-dan-variant-blocks-without-memory-guard.md) | sunny-dan-recommendations | perf | Dan-variant backfill blocks the server with no memory guard |
| [F-018](F-018-dan-variant-skips-stats-cache.md) | stats | logic-gap | Finished dan-variant job does not refresh stats |
| [F-019](F-019-dan-variant-full-scan-on-null-delta.md) | sunny-dan-recommendations | perf | A null score delta enqueues every mania mod combo |
| [F-020](F-020-session-engine-full-rebuild.md) | sessions | perf | Session rebuild falls back to every score |
| [F-021](F-021-stats-loads-all-mania-plays.md) | stats | perf | Stats loads every mania play for a keymode on a cache miss |
| [F-022](F-022-online-score-preview-races-commit.md) | online-score-pull | correctness | Online score preview can replace the rows a commit is writing |
| [F-023](F-023-hub-osu-budget-any-user.md) | hub | security | Any signed-in Hub user can read the global osu! API budget |
| [F-024](F-024-ranked-best-pull-overlap.md) | online-score-pull | correctness | Ranked-best pulls for the same player can overlap |
| [F-025](F-025-download-all-truncated-hub-dump.md) | download-mirrors | correctness | Download-all treats a truncated Hub dump as the full match set |
| [F-026](F-026-search-index-refresh-race.md) | hub | correctness | Search-index refresh is not single-flight per cache row |
| [F-027](F-027-edge-cache-stale-search.md) | hub | correctness | Edge cache can keep search pages after the index changes |
| [F-028](F-028-replay-handler-blocks.md) | preview-replay | perf | Replay route reads, decodes, and judges on the request thread |
| [F-029](F-029-taiko-hud-counts-rolls.md) | preview-replay | correctness | Taiko rewatch HUD counts drumroll and swell rows |
| [F-030](F-030-std-slider-button-sample.md) | preview-replay | correctness | Standard slider checks use the previous frame’s buttons |
| [F-031](F-031-video-export-abort-no-teardown.md) | replay-video-export | design-gap | Cancelling a video export does not tear down the encoder |
| [F-032](F-032-video-export-full-mp4-in-memory.md) | replay-video-export | perf | Video export keeps the whole MP4 in memory |
| [F-033](F-033-skin-archive-entry-names.md) | preview-replay | security | Skin archive entry names are copied from Realm filenames |
| [F-034](F-034-marathon-full-pcm.md) | map-marathon | perf | Marathon export decodes every track into one PCM buffer |
| [F-035](F-035-tosu-cs-object-ignored.md) | tosu-live | correctness | Tosu v2 key count ignores `stats.cs` objects |
| [F-036](F-036-tosu-probe-full-emit.md) | tosu-live | perf | Connected tosu probe still publishes a full live update |
| [F-037](F-037-realm-reader-not-restarted.md) | desktop | logic-gap | Realm-reader is not restarted after it exits |
| [F-038](F-038-overlay-url-blocked-by-respawn-gap.md) | in-game-overlay | logic-gap | Overlay URL changes wait out the crash respawn gap |
| [F-039](F-039-wayland-overlay-show-path.md) | in-game-overlay | correctness | Wayland overlay show path does not undo a hide |
| [F-040](F-040-bms-profile-rederives-all-scores.md) | bms | perf | Opening the BMS profile re-derives every BMS score |
| [F-041](F-041-hub-bms-trusts-client-grade.md) | bms | security | Hub stores client DJ grade and combo lamp without checking judgements |
| [F-042](F-042-hub-bms-accepts-autoplay.md) | bms | logic-gap | Hub accepts autoplay scores that local derive refuses to upload |
| [F-043](F-043-bms-lamp-missing-miss.md) | bms | logic-gap | Combo lamp treats a missing miss count as zero |
| [F-044](F-044-public-bms-tables-first-only.md) | bms | logic-gap | Public BMS tables tab loads only the first catalogue table |
| [F-045](F-045-play-collection-filter-n-plus-one.md) | roxysu-play | perf | Song select filters Realm collections with one lookup per beatmap |
| [F-046](F-046-collection-results-full-page-skeleton.md) | smart-collections | design-gap | Collection result pages replace the whole screen while loading |
| [F-047](F-047-practice-page-change-drops-grid.md) | practice-library | design-gap | Practice library page changes drop the result grid |
| [F-048](F-048-smart-collection-delete-no-confirm.md) | smart-collections | design-gap | Deleting a smart collection does not ask for confirmation |
| [F-049](F-049-overlay-delete-no-confirm.md) | overlay-editor | design-gap | Overlay profile and layer deletes have no confirm |
| [F-050](F-050-overlay-editor-false-empty.md) | overlay-editor | design-gap | Overlay editor offers “create profile” while profiles are still loading |
| [F-051](F-051-preview-error-on-media-color.md) | preview-replay | design-gap | Preview errors use a rose color on the playfield |
| [F-052](F-052-command-palette-no-focus-trap.md) | dashboard | design-gap | Command palette is a modal that does not trap focus |
| [F-053](F-053-session-titles-overflow.md) | sessions | design-gap | Long session names overflow the list and the detail header |
| [F-054](F-054-owned-set-ids-unbounded.md) | download-mirrors | perf | Owned beatmapset ids are returned as one unbounded array |
| [F-055](F-055-mirror-batch-setids-uncapped.md) | download-mirrors | perf | Mirror batch mode `setIds` has no maximum length |
| [F-056](F-056-calc-bundle-arbitrary-hub-url.md) | hub | security | Calc-bundle upload posts the admin token to whatever Hub URL the body names |
| [F-057](F-057-hub-oauth-handoff-race.md) | hub | security | Hub OAuth handoff is redeemed by the first caller who knows the id |
| [F-058](F-058-score-export-loads-all-scores.md) | score-transfer | perf | Score export loads the whole library into one JSON response |
| [F-059](F-059-shutdown-does-not-drain-jobs.md) | cross-cutting | correctness | Shutdown closes the database while background work can still be writing |
| [F-060](F-060-hub-dev-cors-wildcard.md) | hub | security | Non-production Hub defaults CORS to every origin |
| [F-061](F-061-dual-process-migrations.md) | live-sync | correctness | Server and realm-reader both migrate the same SQLite file on startup |
| [F-062](F-062-bms-tables-refresh-every-request.md) | bms | perf | Every BMS tables request refreshes the Hub catalogue first |

## Low

| Id | Feature | Kind | Title |
| --- | --- | --- | --- |
| [F-063](F-063-marathon-cancel-not-wired.md) | map-marathon | logic-gap | Marathon export can be aborted in code and cannot be aborted from the page |
| [F-064](F-064-marathon-mixed-keys-at-generate.md) | map-marathon | logic-gap | Mixed key counts are rejected only when marathon generation starts |
| [F-065](F-065-sse-play-ticks-before-snapshot.md) | tosu-live | logic-gap | Play ticks are dropped until the first live snapshot exists |
| [F-066](F-066-overlay-poll-failure-keeps-host.md) | in-game-overlay | logic-gap | A failed settings poll leaves the overlay host running |
| [F-067](F-067-public-bms-plays-ignore-variant.md) | bms | logic-gap | Public BMS play count ignores the selected variant |
| [F-068](F-068-bms-sessions-capped-at-400.md) | bms | logic-gap | BMS sessions are rebuilt from the latest 400 scores |
| [F-069](F-069-bms-knowledge-chart-pages.md) | bms | logic-gap | BMS knowledge still says chart pages are out of this release |
| [F-070](F-070-practice-card-hover-paints.md) | practice-library | perf | Practice cards animate shadow and background on hover |

## By feature

- **live-sync:** F-001, F-002, F-009, F-010, F-011, F-012, F-013, F-061
- **sessions:** F-003, F-020, F-053
- **smart-collections:** F-004, F-014, F-046, F-048
- **stats:** F-015, F-016, F-018, F-021
- **sunny-dan-recommendations:** F-017, F-019
- **online-score-pull:** F-022, F-024
- **hub:** F-023, F-026, F-027, F-056, F-057, F-060
- **download-mirrors:** F-025, F-054, F-055
- **preview-replay:** F-005, F-028, F-029, F-030, F-033, F-051
- **replay-video-export:** F-031, F-032
- **map-marathon:** F-034, F-063, F-064
- **tosu-live:** F-006, F-035, F-036, F-065
- **desktop:** F-007, F-037
- **in-game-overlay:** F-038, F-039, F-066
- **overlay-editor:** F-049, F-050
- **bms:** F-008, F-040, F-041, F-042, F-043, F-044, F-062, F-067, F-068, F-069
- **roxysu-play:** F-045
- **practice-library:** F-047, F-070
- **dashboard:** F-052
- **score-transfer:** F-058
- **cross-cutting:** F-059
