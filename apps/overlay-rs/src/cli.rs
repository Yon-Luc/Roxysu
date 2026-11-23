//! Clap CLI surface. Preserves the C option names; validates via [`Config`].
//! `--width`/`--height` no longer default to 1920×1090 — they follow the
//! pinned output (L2) unless set explicitly.

use anyhow::Result;
use clap::Parser;

use crate::config::{
    Anchor, Config, DiagnosticFlags, GskRenderer, DEFAULT_MARGIN, DEFAULT_MATCH_APP_ID,
    DEFAULT_OPACITY, DEFAULT_URL, DEFAULT_WATCHDOG_BREACH_SAMPLES, DEFAULT_WATCHDOG_INTERVAL_SEC,
    DEFAULT_WATCHDOG_MAX_AGE_SEC, DEFAULT_WATCHDOG_MAX_FDS, DEFAULT_WATCHDOG_MAX_RSS_MB,
    DEFAULT_WATCHDOG_MAX_STALL_SEC,
};
use crate::focus::MatchMode;

#[derive(Debug, Parser)]
#[command(
    name = "roxysu-overlay-rs",
    about = "Roxysu in-game overlay host (Wayland layer-shell + WebKitGTK)",
    long_about = "Draw the Roxysu /overlay HUD above osu!lazer on wlr-layer-shell compositors \
(Hyprland, sway, niri, …).\n\n\
The surface is always click-through. Requires the client app server (port 4321).\n\n\
--output defaults to the compositor's choice when omitted (not the cursor output)."
)]
pub struct Cli {
    /// HUD page URL. Both `--url VALUE` and `--url=VALUE` work; `=` inside the value is fine.
    #[arg(long, default_value = DEFAULT_URL)]
    pub url: String,

    /// Anchored corner: top-left | top-right | bottom-left | bottom-right.
    #[arg(long, default_value = "top-right", value_parser = parse_anchor)]
    pub anchor: Anchor,

    /// Margin from the anchored edges (all four), in pixels.
    #[arg(long, default_value_t = DEFAULT_MARGIN)]
    pub margin: i32,

    /// HUD width in pixels. Omitted: the pinned output's width (clamped to it).
    #[arg(long)]
    pub width: Option<i32>,

    /// HUD height in pixels. Omitted: the pinned output's height (clamped to it).
    #[arg(long)]
    pub height: Option<i32>,

    /// Window opacity in (0.0, 1.0].
    #[arg(long, default_value_t = DEFAULT_OPACITY)]
    pub opacity: f64,

    /// Pin to this connector or model. When omitted, follow the matched window's output.
    #[arg(long)]
    pub output: Option<String>,

    /// Show only while a matching app is focused (`true`/`false`, `1`/`0`, …).
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    pub follow_focus: bool,

    /// Case-insensitive needle matched against app_id (title if app_id empty).
    #[arg(long, default_value = DEFAULT_MATCH_APP_ID)]
    pub match_app_id: String,

    /// How to apply --match-app-id: contains (C default) | exact.
    #[arg(long, default_value = "contains", value_parser = parse_match_mode)]
    pub match_mode: MatchMode,

    /// Milliseconds to wait before Hide (cancels if Show arrives). Softens alt-tab flicker.
    #[arg(long, default_value_t = 80)]
    pub hide_hysteresis_ms: u64,

    /// Dump toplevels (wlr-foreign-toplevel or Plasma window management) and exit.
    #[arg(long, default_value_t = false)]
    pub list_windows: bool,

    /// Print paint/debug stats (and enable W4 paint counter path when wired).
    #[arg(long, default_value_t = false)]
    pub debug: bool,

    /// Force GTK GSK renderer: gl | ngl | cairo | vulkan.
    #[arg(long, value_parser = parse_gsk)]
    pub gsk_renderer: Option<GskRenderer>,

    /// Disable WebKit DMA-BUF rendering (`WEBKIT_DISABLE_DMABUF_RENDERER=1`).
    /// Off by default: the fallback renderer paints the view's grey background
    /// across the whole window on each partial repaint.
    #[arg(long, default_value_t = false)]
    pub webkit_no_dmabuf: bool,

    /// Keep the WebKit DMA-BUF renderer. Wins over `--webkit-no-dmabuf`.
    #[arg(long, default_value_t = false)]
    pub webkit_dmabuf: bool,

    /// W1 diagnostic: opacity flip + queue_draw timer (default off).
    #[arg(long, default_value_t = false)]
    pub diag_damage_tick: bool,

    /// W2 diagnostic: injected CSS keepalive animation (default off).
    #[arg(long, default_value_t = false)]
    pub diag_inject_keepalive: bool,

    /// W3 diagnostic: reassert layer/anchors on show/refocus (default off).
    #[arg(long, default_value_t = false)]
    pub diag_reassert_placement: bool,

    /// W4 diagnostic: continuous tick callback (default off; implied by --debug).
    #[arg(long, default_value_t = false)]
    pub diag_paint_counter: bool,

    /// W5 diagnostic: JS page visibility toggle on hide/show (default off).
    #[arg(long, default_value_t = false)]
    pub diag_set_page_hidden: bool,

    /// Enable resource watchdog (default on, like C). Disable for long soaks.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    pub watchdog: bool,

    /// Watchdog scan interval in seconds.
    #[arg(long, default_value_t = DEFAULT_WATCHDOG_INTERVAL_SEC)]
    pub watchdog_interval_sec: u64,

    /// Max process age in seconds (`0` = disable age cap; prefer service Restart).
    #[arg(long, default_value_t = DEFAULT_WATCHDOG_MAX_AGE_SEC)]
    pub watchdog_max_age_sec: u64,

    /// Exit for respawn when the GTK main loop has not turned for this many
    /// seconds on `--watchdog-breach-samples` consecutive scans (`0` = off).
    /// A hidden overlay still turns its main loop, so this never fires just
    /// because osu! is unfocused.
    #[arg(long, default_value_t = DEFAULT_WATCHDOG_MAX_STALL_SEC)]
    pub watchdog_max_stall_sec: u64,

    /// Max open FDs among descendants (host excluded).
    #[arg(long, default_value_t = DEFAULT_WATCHDOG_MAX_FDS)]
    pub watchdog_max_fds: u64,

    /// Max descendant-tree RSS in MiB (host excluded; C-compatible).
    #[arg(long, default_value_t = DEFAULT_WATCHDOG_MAX_RSS_MB)]
    pub watchdog_max_rss_mb: u64,

    /// Optional cgroup memory.current cap in MiB.
    #[arg(long)]
    pub watchdog_max_cgroup_mb: Option<u64>,

    /// Consecutive breaching samples required before exit (anti-noise).
    #[arg(long, default_value_t = DEFAULT_WATCHDOG_BREACH_SAMPLES)]
    pub watchdog_breach_samples: u32,

    /// Memory telemetry interval in seconds (0 = off). Observation only; no kills.
    #[arg(long, default_value_t = 0)]
    pub telemetry_interval_sec: u64,

    /// Append telemetry CSV rows to this path (created if missing).
    #[arg(long)]
    pub telemetry_csv: Option<String>,

    /// Phase label stored in each telemetry sample.
    #[arg(long, default_value = "steady")]
    pub telemetry_phase: String,

    /// After mapping, hide then show once to verify click-through survives remap.
    #[arg(long, default_value_t = false, hide = true)]
    pub test_hide_show: bool,
}

fn parse_anchor(s: &str) -> Result<Anchor, String> {
    s.parse::<Anchor>().map_err(|e| e.to_string())
}

fn parse_gsk(s: &str) -> Result<GskRenderer, String> {
    s.parse::<GskRenderer>().map_err(|e| e.to_string())
}

fn parse_match_mode(s: &str) -> Result<MatchMode, String> {
    s.parse::<MatchMode>().map_err(|e| e.to_string())
}

impl Cli {
    pub fn into_config(self) -> Result<Config> {
        let cfg = Config {
            url: self.url,
            anchor: self.anchor,
            margin: self.margin,
            width: self.width,
            height: self.height,
            opacity: self.opacity,
            output: self.output,
            follow_focus: self.follow_focus,
            match_app_id: self.match_app_id,
            match_mode: self.match_mode,
            hide_hysteresis_ms: self.hide_hysteresis_ms,
            list_windows: self.list_windows,
            debug: self.debug,
            gsk_renderer: self.gsk_renderer,
            webkit_no_dmabuf: self.webkit_no_dmabuf && !self.webkit_dmabuf,
            diagnostics: DiagnosticFlags {
                damage_tick: self.diag_damage_tick,
                inject_keepalive: self.diag_inject_keepalive,
                reassert_placement: self.diag_reassert_placement,
                paint_counter: self.diag_paint_counter || self.debug,
                set_page_hidden: self.diag_set_page_hidden,
            },
            watchdog: self.watchdog,
            watchdog_interval_sec: self.watchdog_interval_sec,
            watchdog_max_age_sec: self.watchdog_max_age_sec,
            watchdog_max_stall_sec: self.watchdog_max_stall_sec,
            watchdog_max_fds: self.watchdog_max_fds,
            watchdog_max_rss_mb: self.watchdog_max_rss_mb,
            watchdog_max_cgroup_mb: self.watchdog_max_cgroup_mb,
            watchdog_breach_samples: self.watchdog_breach_samples,
            telemetry_interval_sec: self.telemetry_interval_sec,
            telemetry_csv: self.telemetry_csv,
            telemetry_phase: self.telemetry_phase,
            test_hide_show: self.test_hide_show,
        };
        cfg.validate()?;
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_url_equals_form_with_query_equals() {
        let cli = Cli::try_parse_from([
            "roxysu-overlay-rs",
            "--url=http://127.0.0.1:4321/#/overlay?bg=clear&limit=25",
        ])
        .unwrap();
        let cfg = cli.into_config().unwrap();
        assert!(cfg.url.contains("bg=clear"));
        assert!(cfg.url.contains("limit=25"));
    }

    #[test]
    fn parses_url_separate_value_with_query_equals() {
        let cli = Cli::try_parse_from([
            "roxysu-overlay-rs",
            "--url",
            "http://host/#/overlay?bg=clear&limit=25",
        ])
        .unwrap();
        let cfg = cli.into_config().unwrap();
        assert_eq!(cfg.url, "http://host/#/overlay?bg=clear&limit=25");
    }

    #[test]
    fn rejects_invalid_opacity_and_anchor() {
        let err = Cli::try_parse_from(["roxysu-overlay-rs", "--opacity", "2.0"])
            .unwrap()
            .into_config()
            .unwrap_err();
        assert!(err.to_string().contains("opacity"));

        let err = Cli::try_parse_from(["roxysu-overlay-rs", "--anchor", "middle"]);
        assert!(err.is_err());
    }

    #[test]
    fn follow_focus_and_diag_defaults() {
        let cfg = Cli::try_parse_from(["roxysu-overlay-rs"])
            .unwrap()
            .into_config()
            .unwrap();
        assert!(cfg.follow_focus);
        assert!(!cfg.webkit_no_dmabuf);
        assert!(!cfg.diagnostics.damage_tick);
        assert!(!cfg.diagnostics.inject_keepalive);
        assert_eq!(cfg.anchor, Anchor::TopRight);
        assert!(cfg.output.is_none());
        assert_eq!(cfg.match_mode, MatchMode::Contains);
        assert_eq!(cfg.hide_hysteresis_ms, 80);
    }

    #[test]
    fn match_mode_exact() {
        let cfg = Cli::try_parse_from(["roxysu-overlay-rs", "--match-mode=exact"])
            .unwrap()
            .into_config()
            .unwrap();
        assert_eq!(cfg.match_mode, MatchMode::Exact);
    }

    #[test]
    fn telemetry_flags() {
        let cfg = Cli::try_parse_from([
            "roxysu-overlay-rs",
            "--telemetry-interval-sec=5",
            "--telemetry-csv=/tmp/overlay-telem.csv",
            "--telemetry-phase=gameplay",
        ])
        .unwrap()
        .into_config()
        .unwrap();
        assert_eq!(cfg.telemetry_interval_sec, 5);
        assert_eq!(
            cfg.telemetry_csv.as_deref(),
            Some("/tmp/overlay-telem.csv")
        );
        assert_eq!(cfg.telemetry_phase, "gameplay");
    }

    #[test]
    fn size_defaults_follow_the_output_and_overrides_parse() {
        let cfg = Cli::try_parse_from(["roxysu-overlay-rs"])
            .unwrap()
            .into_config()
            .unwrap();
        // L2: no hard 1920x1090 default anymore.
        assert_eq!(cfg.width, None);
        assert_eq!(cfg.height, None);
        assert_eq!(cfg.surface_size(None).0, crate::config::FALLBACK_WIDTH);

        let cfg = Cli::try_parse_from(["roxysu-overlay-rs", "--width=1280", "--height", "720"])
            .unwrap()
            .into_config()
            .unwrap();
        assert_eq!(cfg.width, Some(1280));
        assert_eq!(cfg.height, Some(720));
        assert_eq!(cfg.surface_size(Some((2560, 1440))), (1280, 720));
    }

    #[test]
    fn debug_implies_paint_counter_diag() {
        let cfg = Cli::try_parse_from(["roxysu-overlay-rs", "--debug"])
            .unwrap()
            .into_config()
            .unwrap();
        assert!(cfg.debug);
        assert!(cfg.diagnostics.paint_counter);
    }

    #[test]
    fn gsk_and_dmabuf_flags() {
        let cfg = Cli::try_parse_from([
            "roxysu-overlay-rs",
            "--gsk-renderer=cairo",
            "--webkit-no-dmabuf",
        ])
        .unwrap()
        .into_config()
        .unwrap();
        assert_eq!(cfg.gsk_renderer, Some(GskRenderer::Cairo));
        assert!(cfg.webkit_no_dmabuf);

        let forced = Cli::try_parse_from(["roxysu-overlay-rs", "--webkit-dmabuf"])
            .unwrap()
            .into_config()
            .unwrap();
        assert!(!forced.webkit_no_dmabuf);
    }

    #[test]
    fn watchdog_defaults_and_disable_age() {
        let cfg = Cli::try_parse_from(["roxysu-overlay-rs"])
            .unwrap()
            .into_config()
            .unwrap();
        assert!(cfg.watchdog);
        assert_eq!(cfg.watchdog_interval_sec, 20);
        assert_eq!(cfg.watchdog_breach_samples, 3);

        let cfg = Cli::try_parse_from([
            "roxysu-overlay-rs",
            "--watchdog=false",
            "--watchdog-max-age-sec=0",
            "--watchdog-breach-samples=5",
        ])
        .unwrap()
        .into_config()
        .unwrap();
        assert!(!cfg.watchdog);
        assert!(cfg.watchdog_thresholds().max_age_sec.is_none());
        assert_eq!(cfg.watchdog_breach_samples, 5);
    }

    #[test]
    fn watchdog_stall_default_disable_and_floor() {
        let cfg = Cli::try_parse_from(["roxysu-overlay-rs"])
            .unwrap()
            .into_config()
            .unwrap();
        assert_eq!(cfg.watchdog_thresholds().max_stall_sec, Some(30));

        let off = Cli::try_parse_from(["roxysu-overlay-rs", "--watchdog-max-stall-sec=0"])
            .unwrap()
            .into_config()
            .unwrap();
        assert!(off.watchdog_thresholds().max_stall_sec.is_none());

        let too_small = Cli::try_parse_from(["roxysu-overlay-rs", "--watchdog-max-stall-sec=2"])
            .unwrap()
            .into_config();
        assert!(too_small.is_err());
    }
}
