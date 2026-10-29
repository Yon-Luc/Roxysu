//! Empty input region so the overlay never steals pointer/touch.
//!
//! Phase 1 preference: GDK `Surface::set_input_region` (no raw wl_compositor).
//! Falls back to documenting failure if GDK cannot supply a Wayland surface yet.

use anyhow::{bail, Context, Result};
use cairo::Region;
use gdk4::prelude::*;
use gtk4::prelude::*;
use gtk4::ApplicationWindow;
use tracing::debug;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickThroughMethod {
    /// `gdk4::Surface::set_input_region` with an empty Cairo region.
    GdkInputRegion,
}

pub fn apply_click_through(window: &ApplicationWindow) -> Result<ClickThroughMethod> {
    let surface = window
        .surface()
        .context("window has no GdkSurface yet (apply on map)")?;

    // Empty region ⇒ no input. GDK Wayland translates this to
    // wl_surface_set_input_region — same effect as the C host's raw binding.
    let empty = Region::create();
    surface.set_input_region(Some(&empty));
    debug!("applied empty GdkSurface input region");

    // Sanity: surface should still exist and be Wayland-backed on our target.
    let name = surface.type_().name();
    if !name.to_lowercase().contains("wayland") {
        bail!("surface type {name:?} is not Wayland; click-through may be ineffective");
    }

    Ok(ClickThroughMethod::GdkInputRegion)
}
