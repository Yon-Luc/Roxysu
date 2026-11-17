//! Session play settings (scroll, skin, layout, keybinds). Not persisted yet.

use std::sync::Arc;

use crate::keybinds::{self, default_lane_keys};
use crate::skin::PlaySkin;

pub const SCROLL_MIN: f32 = 100.0;
pub const SCROLL_MAX: f32 = 1200.0;
pub const SCROLL_DEFAULT: f32 = 400.0;
pub const SCROLL_STEP: f32 = 25.0;

pub const SCALE_MIN: f32 = 0.5;
pub const SCALE_MAX: f32 = 2.0;
pub const SCALE_DEFAULT: f32 = 1.0;
pub const SCALE_STEP: f32 = 0.05;

/// Receptor Y as a fraction of playfield height (matches ~250/280 raster default).
pub const HIT_POS_DEFAULT: f32 = 0.89;
pub const HIT_POS_MIN: f32 = 0.55;
pub const HIT_POS_MAX: f32 = 0.95;
pub const HIT_POS_STEP: f32 = 0.01;

pub const OFFSET_STEP: f32 = 10.0;

#[derive(Clone)]
pub struct PlaySettings {
    /// osu!mania-style scroll speed: pixels per second at full display height.
    pub scroll_speed: f32,
    /// When true and `skin` is loaded, blit note/key sprites instead of solid fills.
    pub use_skin: bool,
    pub skin: Option<Arc<PlaySkin>>,
    pub skin_status: String,
    /// Multiplier on the on-screen playfield box (raster stays half-res).
    pub playfield_scale: f32,
    /// Receptor Y as a fraction of playfield height (0.55–0.95).
    pub hit_position: f32,
    /// Playfield translation from center, in window points (lazer-like layout).
    pub offset_x: f32,
    pub offset_y: f32,
    /// Physical key names per lane (7K), lowercase; `space` for space bar.
    pub lane_keys: [String; 7],
    /// When true in play, dragging the stage moves it (layout edit).
    pub layout_edit: bool,
}

impl Default for PlaySettings {
    fn default() -> Self {
        Self {
            scroll_speed: SCROLL_DEFAULT,
            use_skin: false,
            skin: None,
            skin_status: "skin off (procedural)".into(),
            playfield_scale: SCALE_DEFAULT,
            hit_position: HIT_POS_DEFAULT,
            offset_x: 0.0,
            offset_y: 0.0,
            lane_keys: default_lane_keys(),
            layout_edit: false,
        }
    }
}

impl PlaySettings {
    pub fn clamp_scroll(speed: f32) -> f32 {
        speed.clamp(SCROLL_MIN, SCROLL_MAX)
    }

    pub fn clamp_scale(scale: f32) -> f32 {
        scale.clamp(SCALE_MIN, SCALE_MAX)
    }

    pub fn clamp_hit_position(pos: f32) -> f32 {
        pos.clamp(HIT_POS_MIN, HIT_POS_MAX)
    }

    pub fn nudge_scroll(&mut self, delta: f32) {
        self.scroll_speed = Self::clamp_scroll(self.scroll_speed + delta);
    }

    pub fn nudge_scale(&mut self, delta: f32) {
        self.playfield_scale = Self::clamp_scale(self.playfield_scale + delta);
    }

    pub fn nudge_hit_position(&mut self, delta: f32) {
        self.hit_position = Self::clamp_hit_position(self.hit_position + delta);
    }

    pub fn nudge_offset(&mut self, dx: f32, dy: f32) {
        self.offset_x = (self.offset_x + dx).clamp(-800.0, 800.0);
        self.offset_y = (self.offset_y + dy).clamp(-600.0, 600.0);
    }

    pub fn reset_layout(&mut self) {
        self.playfield_scale = SCALE_DEFAULT;
        self.hit_position = HIT_POS_DEFAULT;
        self.offset_x = 0.0;
        self.offset_y = 0.0;
    }

    pub fn reset_keys(&mut self) {
        self.lane_keys = default_lane_keys();
    }

    pub fn set_lane_key(&mut self, lane: usize, raw: &str) -> Result<(), String> {
        if lane >= 7 {
            return Err("lane out of range".into());
        }
        let Some(name) = keybinds::normalize_key_name(raw) else {
            return Err(format!("unsupported key '{raw}'"));
        };
        if self
            .lane_keys
            .iter()
            .enumerate()
            .any(|(i, k)| i != lane && k == &name)
        {
            return Err(format!("'{name}' already bound"));
        }
        // Keep Esc and a few play hotkeys free.
        if matches!(
            name.as_str(),
            "escape" | "bracketleft" | "bracketright" | "minus" | "equal"
        ) {
            return Err(format!("'{name}' is reserved"));
        }
        self.lane_keys[lane] = name;
        Ok(())
    }

    pub fn set_skin(&mut self, skin: Option<Arc<PlaySkin>>, status: String) {
        self.skin = skin;
        self.skin_status = status;
        if self.skin.is_none() {
            self.use_skin = false;
        }
    }

    pub fn toggle_skin_use(&mut self) -> bool {
        if self.skin.is_none() {
            self.use_skin = false;
            return false;
        }
        self.use_skin = !self.use_skin;
        true
    }

    pub fn skin_mode_label(&self) -> String {
        if self.use_skin {
            if let Some(skin) = &self.skin {
                format!("skin:{}", skin.name)
            } else {
                "skin:?".into()
            }
        } else {
            "skin:off".into()
        }
    }

    pub fn bindings_hint(&self) -> String {
        keybinds::format_bindings_hint(&self.lane_keys)
    }
}
