/** Cross-process settings KV keys written/read via the shared SQLite `settings` table. */

/** Web UI focus flag: "1" focused, "0" unfocused. */
export const SYNC_UI_FOCUSED_KEY = "sync.ui_focused";

/** Opt-in: when "1", realm-reader honors sync.ui_focused. Missing/"0" = never pause. */
export const SYNC_PAUSE_WHEN_UNFOCUSED_KEY = "sync.pause_when_unfocused";

/**
 * Set to "1" while Roxysu writes collections to client.realm.
 * Cleared on server / realm-reader startup if left stuck after a crash.
 */
export const SYNC_REALM_READER_PAUSED_KEY = "sync.realm_reader_paused";

/**
 * Reconcile catch-up stall breaker (integer string, default "0").
 * realm-reader bumps it when a reconcile finds a Realm/SQLite row-count gap
 * its catch-up pass cannot close (rows that can never mirror, e.g. a Beatmap
 * whose BeatmapSet link is gone). At >= the reader's stall limit, reconcile
 * stops retrying catch-up until a successful incremental moves rows again.
 */
export const SYNC_CATCHUP_STALLED_KEY = "sync.catchup_stalled";

/**
 * Score username filter preference.
 * - missing / "auto" → most common `user_username` among scores
 * - "*" → show all usernames (including downloaded replays)
 * - a username string → exact match (legacy single select)
 * - JSON array string → match any of the listed usernames
 */
export const SCORES_USERNAME_FILTER_KEY = "scores.username_filter";

export const SCORES_USERNAME_AUTO = "auto";
export const SCORES_USERNAME_ALL = "*";

/**
 * Gamemode / ruleset filter preference.
 * - missing / "auto" → ruleset with the most scores
 * - "*" → show all gamemodes
 * - a ruleset short name → exact match (`osu` / `taiko` / `fruits` / `mania`)
 */
export const SCORES_GAMEMODE_FILTER_KEY = "scores.gamemode_filter";

export const SCORES_GAMEMODE_AUTO = "auto";
export const SCORES_GAMEMODE_ALL = "*";

/**
 * Overlay profiles for the `/overlay` HUD page.
 * JSON array of OverlayProfile objects (see apps/server/src/overlay/profiles.ts).
 * Consumers pick one via `#/overlay?profile=<name>`; missing → legacy default layout.
 */
export const OVERLAY_PROFILES_KEY = "overlay.profiles";

/**
 * Skin snapshot served to overlay consumers (OBS browser source / Wayland
 * host) so they render the same skins as the editor's browser: procedural
 * mania/std/taiko/catch configs plus imported .osk sprites as data URLs.
 * JSON object; see apps/server/public/lib/overlaySkins.ts.
 */
export const OVERLAY_SKINS_KEY = "overlay.skins";

/**
 * Full HUD URL for the desktop-spawned In-game overlay host, e.g.
 * http://127.0.0.1:4321/#/overlay?bg=clear&profile=Classic.
 * Missing/empty → default (#/overlay?bg=clear). The desktop Electron shell
 * polls GET /api/settings and restarts the overlay child when this changes.
 */
export const OVERLAY_HOST_URL_KEY = "overlay.host_url";
