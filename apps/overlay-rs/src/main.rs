//! Phase 1 prototype: GTK4 + WebKitGTK + layer-shell + click-through + foreign-toplevel.
//! Full CLI / watchdog / telemetry land in later phases.

mod click_through;
mod focus;
mod overlay;

use anyhow::{bail, Context, Result};
use clap::Parser;
use gtk4::prelude::*;
use gtk4::{Application, CssProvider, STYLE_PROVIDER_PRIORITY_APPLICATION};
use gtk4_layer_shell::is_supported as layer_shell_supported;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::overlay::{OverlayConfig, OverlayHost};

const DEFAULT_URL: &str =
    "http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic";
const DEFAULT_MATCH: &str = "osu";

#[derive(Debug, Parser)]
#[command(
    name = "roxysu-overlay-rs",
    about = "Roxysu in-game overlay host (Rust Phase 1 prototype)"
)]
struct Cli {
    /// HUD page URL (`=` inside the value is fine with clap).
    #[arg(long, default_value = DEFAULT_URL)]
    url: String,

    /// Window width in pixels.
    #[arg(long, default_value_t = 1920)]
    width: i32,

    /// Window height in pixels.
    #[arg(long, default_value_t = 1090)]
    height: i32,

    /// Target output connector or model (compositor default if omitted).
    #[arg(long)]
    output: Option<String>,

    /// Show only while a matching app is focused.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    follow_focus: bool,

    /// Case-insensitive substring matched against app_id (title if app_id empty).
    #[arg(long, default_value = DEFAULT_MATCH)]
    match_app_id: String,

    /// Dump known foreign-toplevel windows and exit.
    #[arg(long, default_value_t = false)]
    list_windows: bool,

    /// After mapping, hide then show once to verify click-through survives remap.
    #[arg(long, default_value_t = false)]
    test_hide_show: bool,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    if cli.width <= 0 || cli.height <= 0 {
        bail!("--width and --height must be positive");
    }

    // NON_UNIQUE: a leftover prototype must not silently steal new launches
    // (default GtkApplication remotes into the first instance and exits).
    let app = Application::builder()
        .application_id("dev.roxysu.overlay")
        .flags(gtk4::gio::ApplicationFlags::NON_UNIQUE)
        .build();

    let config = OverlayConfig {
        url: cli.url,
        width: cli.width,
        height: cli.height,
        output: cli.output,
        follow_focus: cli.follow_focus,
        match_app_id: cli.match_app_id,
        list_windows: cli.list_windows,
        test_hide_show: cli.test_hide_show,
    };

    app.connect_activate(move |app| {
        // GtkApplication exits as soon as activate returns if no window is
        // mapped and nothing holds it. Follow-focus starts hidden, so hold
        // the app open for the whole process lifetime.
        std::mem::forget(app.hold());

        if let Err(err) = run_app(app, config.clone()) {
            eprintln!("roxysu-overlay-rs: {err:#}");
            std::process::exit(1);
        }
    });

    // Do not forward argv to GTK — clap already consumed it. Passing
    // `--list-windows` etc. into GtkApplication makes it exit with "Unknown option".
    let code = app.run_with_args(&[] as &[&str]);
    if code != glib::ExitCode::SUCCESS {
        bail!("GTK application exited with {code:?}");
    }
    Ok(())
}

fn run_app(app: &Application, config: OverlayConfig) -> Result<()> {
    if std::env::var_os("WAYLAND_DISPLAY").is_none()
        && std::env::var_os("WAYLAND_SOCKET").is_none()
    {
        bail!(
            "no Wayland display detected.\n\
             This host is wlroots-Wayland only; on X11 use the HUD as an OBS browser source:\n  {}",
            config.url
        );
    }

    if !layer_shell_supported() {
        bail!(
            "compositor does not support zwlr_layer_shell_v1.\n\
             Use a wlroots-family compositor (Hyprland, sway, niri, river, KDE)."
        );
    }

    let display = gdk4::Display::default().context("no GDK display")?;
    let css = CssProvider::new();
    css.load_from_string(
        "window { background: transparent; } webview { background: transparent; }",
    );
    gtk4::style_context_add_provider_for_display(
        &display,
        &css,
        STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    let host = OverlayHost::new(app, config)?;
    host.present_initial()?;
    info!("overlay host ready (Phase 1 prototype)");
    Ok(())
}
