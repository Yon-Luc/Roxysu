//! Roxysu overlay host (Rust). Phase 2: full CLI/config. Later: reload, telemetry, watchdog.

mod click_through;
mod cli;
mod config;
mod focus;
mod overlay;

use anyhow::{bail, Context, Result};
use clap::Parser;
use gtk4::prelude::*;
use gtk4::{Application, CssProvider, STYLE_PROVIDER_PRIORITY_APPLICATION};
use gtk4_layer_shell::is_supported as layer_shell_supported;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::cli::Cli;
use crate::config::Config;
use crate::overlay::OverlayHost;

fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = cli.into_config()?;

    // W7 must be set before GTK/WebKit initialize.
    config.apply_process_env();

    let filter = if config.debug {
        EnvFilter::from_default_env().add_directive("debug".parse()?)
    } else {
        EnvFilter::from_default_env().add_directive("info".parse()?)
    };
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .init();

    // NON_UNIQUE: a leftover prototype must not silently steal new launches.
    let app = Application::builder()
        .application_id("dev.roxysu.overlay")
        .flags(gtk4::gio::ApplicationFlags::NON_UNIQUE)
        .build();

    app.connect_activate(move |app| {
        // Follow-focus starts hidden; hold so GtkApplication does not exit.
        std::mem::forget(app.hold());

        if let Err(err) = run_app(app, config.clone()) {
            eprintln!("roxysu-overlay-rs: {err:#}");
            std::process::exit(1);
        }
    });

    // Do not forward argv to GTK — clap already consumed it.
    let code = app.run_with_args(&[] as &[&str]);
    if code != glib::ExitCode::SUCCESS {
        bail!("GTK application exited with {code:?}");
    }
    Ok(())
}

fn run_app(app: &Application, config: Config) -> Result<()> {
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
    info!("overlay host ready");
    Ok(())
}
