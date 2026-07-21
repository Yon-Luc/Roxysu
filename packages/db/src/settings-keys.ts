/** Cross-process settings KV keys written/read via the shared SQLite `settings` table. */

/** Web UI focus flag: "1" focused, "0" unfocused. */
export const SYNC_UI_FOCUSED_KEY = "sync.ui_focused";

/** Opt-in: when "1", realm-reader honors sync.ui_focused. Missing/"0" = never pause. */
export const SYNC_PAUSE_WHEN_UNFOCUSED_KEY = "sync.pause_when_unfocused";

/** Set to "1" while Roxysu writes collections to client.realm. */
export const SYNC_REALM_READER_PAUSED_KEY = "sync.realm_reader_paused";
