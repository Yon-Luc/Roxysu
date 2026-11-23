//! When the layer surface may be mapped.
//!
//! Mapping before the HUD has a transparent frame paints WebKit's opaque grey
//! clear across the whole window and hides the playfield. Focus intent alone
//! is not enough.
//!
//! Placement is a third gate, applied before `wants_visible` is set: while
//! following osu!, the host does not set `wants_visible` until an output hint
//! resolved to a monitor (D1). Once a hint arrives the normal map path runs.

/// Map only when focus (or the always-visible fallback) wants the surface
/// and the page has signaled a transparent frame.
pub fn should_map_overlay(wants_visible: bool, page_ready: bool) -> bool {
    wants_visible && page_ready
}

#[cfg(test)]
mod tests {
    use super::should_map_overlay;

    #[test]
    fn stays_unmapped_until_both_focus_and_page_are_ready() {
        assert!(!should_map_overlay(false, false));
        assert!(!should_map_overlay(true, false));
        assert!(!should_map_overlay(false, true));
        assert!(should_map_overlay(true, true));
    }
}
