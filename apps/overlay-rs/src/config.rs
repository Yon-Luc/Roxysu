//! Typed overlay configuration and validation (Phase 2).
//!
//! Invalid values error out — unlike the C host, which silently fell back
//! for width/height/opacity and accepted any `atoi` margin.

use anyhow::{bail, Result};
use std::str::FromStr;

use crate::focus::{MatchMode, MatchPolicy};

pub const DEFAULT_URL: &str =
    "http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic";
pub const DEFAULT_MATCH_APP_ID: &str = "osu";
pub const DEFAULT_WIDTH: i32 = 1920;
pub const DEFAULT_HEIGHT: i32 = 1090;
pub const DEFAULT_OPACITY: f64 = 1.0;
pub const DEFAULT_MARGIN: i32 = 0;

/// Watchdog defaults mirrored from the C host (Phase 6).
pub const DEFAULT_WATCHDOG_MAX_AGE_SEC: u64 = 1800;
pub const DEFAULT_WATCHDOG_MAX_FDS: u64 = 450;
pub const DEFAULT_WATCHDOG_MAX_RSS_MB: u64 = 4200;
pub const DEFAULT_WATCHDOG_INTERVAL_SEC: u64 = 20;
pub const DEFAULT_WATCHDOG_BREACH_SAMPLES: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Anchor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TopLeft => "top-left",
            Self::TopRight => "top-right",
            Self::BottomLeft => "bottom-left",
            Self::BottomRight => "bottom-right",
        }
    }

    pub fn top(self) -> bool {
        matches!(self, Self::TopLeft | Self::TopRight)
    }

    pub fn left(self) -> bool {
        matches!(self, Self::TopLeft | Self::BottomLeft)
    }
}

impl FromStr for Anchor {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "top-left" => Ok(Self::TopLeft),
            "top-right" => Ok(Self::TopRight),
            "bottom-left" => Ok(Self::BottomLeft),
            "bottom-right" => Ok(Self::BottomRight),
            other => bail!(
                "unknown --anchor '{other}' (expected top-left|top-right|bottom-left|bottom-right)"
            ),
        }
    }
}

impl std::fmt::Display for Anchor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GskRenderer {
    Gl,
    Ngl,
    Cairo,
    Vulkan,
}

impl GskRenderer {
    pub fn as_env(self) -> &'static str {
        match self {
            Self::Gl => "gl",
            Self::Ngl => "ngl",
            Self::Cairo => "cairo",
            Self::Vulkan => "vulkan",
        }
    }
}

impl FromStr for GskRenderer {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "gl" => Ok(Self::Gl),
            "ngl" => Ok(Self::Ngl),
            "cairo" => Ok(Self::Cairo),
            "vulkan" => Ok(Self::Vulkan),
            other => bail!(
                "unknown --gsk-renderer '{other}' (expected gl|ngl|cairo|vulkan)"
            ),
        }
    }
}

impl std::fmt::Display for GskRenderer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_env())
    }
}

/// Temporary diagnostic workarounds from the C host (W1–W5). Default off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DiagnosticFlags {
    /// W1: opacity flip + queue_draw timer.
    pub damage_tick: bool,
    /// W2: injected CSS keepalive animation.
    pub inject_keepalive: bool,
    /// W3: reassert layer/anchors on show/refocus.
    pub reassert_placement: bool,
    /// W4: continuous tick callback (frame-clock side effect).
    pub paint_counter: bool,
    /// W5: JS page visibility toggle on hide/show.
    pub set_page_hidden: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub url: String,
    pub anchor: Anchor,
    pub margin: i32,
    pub width: i32,
    pub height: i32,
    pub opacity: f64,
    /// Compositor default when `None` (not "cursor output" — C help was wrong).
    pub output: Option<String>,
    pub follow_focus: bool,
    pub match_app_id: String,
    /// `contains` (C default) or `exact`.
    pub match_mode: MatchMode,
    /// Delay before applying Hide so brief focus gaps (alt-tab) do not flicker.
    pub hide_hysteresis_ms: u64,
    pub list_windows: bool,
    pub debug: bool,
    pub gsk_renderer: Option<GskRenderer>,
    pub webkit_no_dmabuf: bool,
    pub diagnostics: DiagnosticFlags,
    /// When false, no resource watchdog (useful for long telemetry soaks).
    pub watchdog: bool,
    pub watchdog_interval_sec: u64,
    /// 0 disables the age cap (prefer systemd/desktop Restart for longevity).
    pub watchdog_max_age_sec: u64,
    pub watchdog_max_fds: u64,
    pub watchdog_max_rss_mb: u64,
    /// Optional cgroup memory.current cap in MiB (`None` = unused).
    pub watchdog_max_cgroup_mb: Option<u64>,
    /// Consecutive breaching samples required before exit.
    pub watchdog_breach_samples: u32,
    /// 0 = telemetry off; otherwise sample interval in seconds (Phase 5).
    pub telemetry_interval_sec: u64,
    /// Optional CSV path for telemetry rows.
    pub telemetry_csv: Option<String>,
    /// Label written into each sample (startup/steady/gameplay/…).
    pub telemetry_phase: String,
    /// Phase 1 test hook; not a C flag.
    pub test_hide_show: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            url: DEFAULT_URL.to_string(),
            anchor: Anchor::TopRight,
            margin: DEFAULT_MARGIN,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            opacity: DEFAULT_OPACITY,
            output: None,
            follow_focus: true,
            match_app_id: DEFAULT_MATCH_APP_ID.to_string(),
            match_mode: MatchMode::Contains,
            hide_hysteresis_ms: 80,
            list_windows: false,
            debug: false,
            gsk_renderer: None,
            webkit_no_dmabuf: false,
            diagnostics: DiagnosticFlags::default(),
            watchdog: true,
            watchdog_interval_sec: DEFAULT_WATCHDOG_INTERVAL_SEC,
            watchdog_max_age_sec: DEFAULT_WATCHDOG_MAX_AGE_SEC,
            watchdog_max_fds: DEFAULT_WATCHDOG_MAX_FDS,
            watchdog_max_rss_mb: DEFAULT_WATCHDOG_MAX_RSS_MB,
            watchdog_max_cgroup_mb: None,
            watchdog_breach_samples: DEFAULT_WATCHDOG_BREACH_SAMPLES,
            telemetry_interval_sec: 0,
            telemetry_csv: None,
            telemetry_phase: "steady".into(),
            test_hide_show: false,
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<()> {
        validate_url(&self.url)?;
        if self.width <= 0 {
            bail!("--width must be a positive integer (got {})", self.width);
        }
        if self.height <= 0 {
            bail!("--height must be a positive integer (got {})", self.height);
        }
        if !(self.opacity > 0.0 && self.opacity <= 1.0) {
            bail!(
                "--opacity must be in (0.0, 1.0] (got {})",
                self.opacity
            );
        }
        if self.margin < 0 {
            bail!("--margin must be >= 0 (got {})", self.margin);
        }
        if self.match_app_id.is_empty() {
            bail!("--match-app-id must not be empty");
        }
        if self.hide_hysteresis_ms > 5_000 {
            bail!("--hide-hysteresis-ms must be <= 5000");
        }
        // max_age_sec == 0 means disabled (Phase 6).
        if self.watchdog_interval_sec == 0 {
            bail!("--watchdog-interval-sec must be > 0");
        }
        if self.watchdog_max_fds == 0 {
            bail!("--watchdog-max-fds must be > 0");
        }
        if self.watchdog_max_rss_mb == 0 {
            bail!("--watchdog-max-rss-mb must be > 0");
        }
        if self.watchdog_breach_samples == 0 {
            bail!("--watchdog-breach-samples must be > 0");
        }
        if let Some(0) = self.watchdog_max_cgroup_mb {
            bail!("--watchdog-max-cgroup-mb must be > 0 when set");
        }
        if self.list_windows && self.test_hide_show {
            bail!("--list-windows and --test-hide-show conflict");
        }
        if self.telemetry_interval_sec > 0 && self.telemetry_interval_sec < 1 {
            bail!("--telemetry-interval-sec must be 0 (off) or >= 1");
        }
        if self.telemetry_phase.is_empty() {
            bail!("--telemetry-phase must not be empty");
        }
        Ok(())
    }

    /// Apply W7 env knobs before GTK/WebKit init.
    pub fn apply_process_env(&self) {
        if let Some(renderer) = self.gsk_renderer {
            std::env::set_var("GSK_RENDERER", renderer.as_env());
        }
        if self.webkit_no_dmabuf {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    pub fn match_policy(&self) -> MatchPolicy {
        MatchPolicy::new(self.match_app_id.clone(), self.match_mode)
    }

    pub fn watchdog_thresholds(&self) -> crate::watchdog::Thresholds {
        crate::watchdog::Thresholds {
            max_age_sec: (self.watchdog_max_age_sec > 0).then_some(self.watchdog_max_age_sec),
            max_fds: self.watchdog_max_fds,
            max_rss_mb: self.watchdog_max_rss_mb,
            max_cgroup_mb: self.watchdog_max_cgroup_mb,
            breach_samples: self.watchdog_breach_samples,
        }
    }
}

pub fn validate_url(url: &str) -> Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        bail!("--url must not be empty");
    }
    let ok = trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("file://");
    if !ok {
        bail!("--url must start with http://, https://, or file:// (got '{url}')");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_validates() {
        Config::default().validate().unwrap();
    }

    #[test]
    fn url_with_query_equals_is_accepted() {
        let mut cfg = Config::default();
        cfg.url =
            "http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic".into();
        cfg.validate().unwrap();
        validate_url(&cfg.url).unwrap();
    }

    #[test]
    fn rejects_empty_and_non_http_url() {
        assert!(validate_url("").is_err());
        assert!(validate_url("ftp://x").is_err());
        assert!(validate_url("not-a-url").is_err());
    }

    #[test]
    fn rejects_invalid_dimensions_opacity_margin() {
        let mut cfg = Config::default();
        cfg.width = 0;
        assert!(cfg.validate().is_err());
        cfg.width = DEFAULT_WIDTH;
        cfg.height = -1;
        assert!(cfg.validate().is_err());
        cfg.height = DEFAULT_HEIGHT;
        cfg.opacity = 0.0;
        assert!(cfg.validate().is_err());
        cfg.opacity = 1.5;
        assert!(cfg.validate().is_err());
        cfg.opacity = 1.0;
        cfg.margin = -2;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn anchor_and_gsk_parse() {
        assert_eq!("top-right".parse::<Anchor>().unwrap(), Anchor::TopRight);
        assert!("nope".parse::<Anchor>().is_err());
        assert_eq!("cairo".parse::<GskRenderer>().unwrap(), GskRenderer::Cairo);
        assert!("metal".parse::<GskRenderer>().is_err());
        assert_eq!("exact".parse::<MatchMode>().unwrap(), MatchMode::Exact);
        assert!("regex".parse::<MatchMode>().is_err());
    }

    #[test]
    fn list_windows_conflicts_with_test_hide_show() {
        let mut cfg = Config::default();
        cfg.list_windows = true;
        cfg.test_hide_show = true;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn diagnostics_default_off() {
        let d = DiagnosticFlags::default();
        assert!(!d.damage_tick);
        assert!(!d.inject_keepalive);
        assert!(!d.reassert_placement);
        assert!(!d.paint_counter);
        assert!(!d.set_page_hidden);
    }
}
