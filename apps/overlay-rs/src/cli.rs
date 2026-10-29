//! Clap CLI surface. Preserves C option names/defaults; validates via [`Config`].

use anyhow::Result;
use clap::Parser;

use crate::config::{
    Anchor, Config, DiagnosticFlags, GskRenderer, DEFAULT_HEIGHT, DEFAULT_MARGIN,
    DEFAULT_MATCH_APP_ID, DEFAULT_OPACITY, DEFAULT_URL, DEFAULT_WATCHDOG_BREACH_SAMPLES,
    DEFAULT_WATCHDOG_INTERVAL_SEC, DEFAULT_WATCHDOG_MAX_AGE_SEC, DEFAULT_WATCHDOG_MAX_FDS,
    DEFAULT_WATCHDOG_MAX_RSS_MB, DEFAULT_WIDTH,
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

    /// Window width in pixels.
    #[arg(long, default_value_t = DEFAULT_WIDTH)]
    pub width: i32,

    /// Window height in pixels.
    #[arg(long, default_value_t = DEFAULT_HEIGHT)]
    pub height: i32,

    /// Window opacity in (0.0, 1.0].
    #[arg(long, default_value_t = DEFAULT_OPACITY)]
    pub opacity: f64,

    /// Target monitor by connector or model. Omit for compositor default.
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

    /// Dump known foreign-toplevel windows and exit.
    #[arg(long, default_value_t = false)]
    pub list_windows: bool,

    /// Print paint/debug stats (and enable W4 paint counter path when wired).
    #[arg(long, default_value_t = false)]
    pub debug: bool,

    /// Force GTK GSK renderer: gl | ngl | cairo | vulkan.
    #[arg(long, value_parser = parse_gsk)]
    pub gsk_renderer: Option<GskRenderer>,

    /// Disable WebKit DMA-BUF rendering (`WEBKIT_DISABLE_DMABUF_RENDERER=1`).
    /// Default on: a transparent DMA-BUF surface paints uninitialized pixels
    /// after the overlay has been up for a while.
    #[arg(long, default_value_t = false)]
    pub webkit_no_dmabuf: bool,

    /// Force the WebKit DMA-BUF renderer (opt out of the default disable).
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
            // On unless explicitly opted back in. `--webkit-no-dmabuf` stays
            // accepted so older launchers keep working.
            webkit_no_dmabuf: self.webkit_no_dmabuf || !self.webkit_dmabuf,
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
        assert!(cfg.webkit_no_dmabuf);
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
}
