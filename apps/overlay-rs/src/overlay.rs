use anyhow::{Context, Result};
use gdk4::prelude::*;
use gtk4::prelude::*;
use gtk4::{Application, ApplicationWindow};
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;
use tracing::{info, warn};
use webkit6::prelude::*;
use webkit6::WebView;

use crate::click_through::{apply_click_through, ClickThroughMethod};
use crate::config::Config;
use crate::focus::{self, FocusCommand, FocusEvent};

pub struct OverlayHost {
    window: ApplicationWindow,
    #[allow(dead_code)]
    webview: WebView,
    config: Config,
    mapped: Rc<RefCell<bool>>,
    click_method: Rc<RefCell<Option<ClickThroughMethod>>>,
}

impl OverlayHost {
    pub fn new(app: &Application, config: Config) -> Result<Self> {
        let window = ApplicationWindow::builder()
            .application(app)
            .title("Roxysu overlay")
            .default_width(config.width)
            .default_height(config.height)
            .build();
        window.set_opacity(config.opacity);

        window.init_layer_shell();
        window.set_layer(Layer::Overlay);
        window.set_namespace(Some("roxysu-overlay"));
        window.set_exclusive_zone(-1);
        window.set_keyboard_mode(KeyboardMode::None);

        let top = config.anchor.top();
        let left = config.anchor.left();
        window.set_anchor(Edge::Top, top);
        window.set_anchor(Edge::Bottom, !top);
        window.set_anchor(Edge::Left, left);
        window.set_anchor(Edge::Right, !left);
        for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
            window.set_margin(edge, config.margin);
        }

        if let Some(ref name) = config.output {
            let display = gtk4::prelude::WidgetExt::display(&window);
            let monitor = find_monitor_by_name(&display, name)
                .with_context(|| format!("no output matches '{name}'"))?;
            window.set_monitor(Some(&monitor));
            info!(output = %name, "pinned to monitor");
        }

        let webview = WebView::new();
        let transparent = gdk4::RGBA::new(0.0, 0.0, 0.0, 0.0);
        webview.set_background_color(&transparent);
        webview.load_uri(&config.url);
        window.set_child(Some(&webview));

        let mapped = Rc::new(RefCell::new(false));
        let click_method = Rc::new(RefCell::new(None));

        {
            let mapped = Rc::clone(&mapped);
            let click_method = Rc::clone(&click_method);
            let window_weak = window.downgrade();
            window.connect_map(move |_| {
                *mapped.borrow_mut() = true;
                if let Some(window) = window_weak.upgrade() {
                    match apply_click_through(&window) {
                        Ok(method) => {
                            info!(?method, "click-through applied on map");
                            *click_method.borrow_mut() = Some(method);
                        }
                        Err(err) => warn!(error = %err, "click-through failed on map"),
                    }
                }
            });
        }
        {
            let mapped = Rc::clone(&mapped);
            window.connect_unmap(move |_| {
                *mapped.borrow_mut() = false;
            });
        }

        if config.diagnostics.damage_tick
            || config.diagnostics.inject_keepalive
            || config.diagnostics.reassert_placement
            || config.diagnostics.set_page_hidden
        {
            warn!(
                ?config.diagnostics,
                "diagnostic workarounds requested; W1–W5 behavior is wired in Phase 3"
            );
        }

        Ok(Self {
            window,
            webview,
            config,
            mapped,
            click_method,
        })
    }

    pub fn present_initial(self) -> Result<()> {
        if self.config.list_windows {
            let (tx, rx) = mpsc::channel::<FocusEvent>();
            let match_app_id = self.config.match_app_id.clone();
            std::thread::Builder::new()
                .name("overlay-focus".into())
                .spawn(move || {
                    if let Err(err) = focus::run_list_windows(tx, match_app_id) {
                        eprintln!("roxysu-overlay-rs: list-windows failed: {err:#}");
                    }
                })
                .context("spawn focus thread")?;
            match rx.recv_timeout(Duration::from_secs(3)) {
                Ok(FocusEvent::Dump(lines)) => {
                    eprintln!("roxysu-overlay-rs: known windows (focused=*):");
                    for line in lines {
                        eprintln!("  {line}");
                    }
                }
                Err(_) => warn!("timed out waiting for foreign-toplevel dump"),
            }
            if let Some(app) = self.window.application() {
                app.quit();
            }
            return Ok(());
        }

        if self.config.follow_focus {
            self.start_focus_tracking()?;
            info!(
                match_app_id = %self.config.match_app_id,
                "follow-focus enabled; waiting for matching activation"
            );
        } else {
            self.window.present();
            info!("follow-focus disabled; always visible");
        }

        if self.config.test_hide_show {
            let window = self.window.clone();
            let mapped = Rc::clone(&self.mapped);
            let click_method = Rc::clone(&self.click_method);
            glib::timeout_add_local_once(Duration::from_secs(2), move || {
                info!("test-hide-show: hiding");
                window.set_visible(false);
                let window2 = window.clone();
                let mapped = Rc::clone(&mapped);
                let click_method = Rc::clone(&click_method);
                glib::timeout_add_local_once(Duration::from_millis(500), move || {
                    info!("test-hide-show: showing again");
                    window2.set_visible(true);
                    window2.present();
                    glib::timeout_add_local_once(Duration::from_millis(300), move || {
                        let still_mapped = *mapped.borrow();
                        let method = *click_method.borrow();
                        info!(
                            still_mapped,
                            ?method,
                            "test-hide-show: post-remap click-through state"
                        );
                    });
                });
            });
        }

        Ok(())
    }

    fn start_focus_tracking(&self) -> Result<()> {
        let (tx, rx) = async_channel::unbounded::<FocusCommand>();

        let match_app_id = self.config.match_app_id.clone();
        std::thread::Builder::new()
            .name("overlay-focus".into())
            .spawn(move || {
                if let Err(err) = focus::run_focus_loop(match_app_id, tx) {
                    eprintln!("roxysu-overlay-rs: focus thread exited: {err:#}");
                }
            })
            .context("spawn focus thread")?;

        let window = self.window.clone();
        let last = Rc::new(RefCell::new(None::<bool>));
        glib::spawn_future_local(async move {
            while let Ok(cmd) = rx.recv().await {
                match cmd {
                    FocusCommand::Show => {
                        if *last.borrow() != Some(true) {
                            info!("focus: show");
                            window.set_visible(true);
                            window.present();
                            *last.borrow_mut() = Some(true);
                        }
                    }
                    FocusCommand::Hide => {
                        if *last.borrow() != Some(false) {
                            info!("focus: hide");
                            window.set_visible(false);
                            *last.borrow_mut() = Some(false);
                        }
                    }
                    FocusCommand::Disconnected => {
                        warn!("focus tracking disconnected; leaving visibility unchanged");
                    }
                }
            }
        });

        Ok(())
    }
}

fn find_monitor_by_name(display: &gdk4::Display, name: &str) -> Option<gdk4::Monitor> {
    let monitors = display.monitors();
    let n = monitors.n_items();
    for i in 0..n {
        let Some(monitor) = monitors
            .item(i)
            .and_then(|o| o.downcast::<gdk4::Monitor>().ok())
        else {
            continue;
        };
        let connector = monitor.connector().unwrap_or_default();
        let model = monitor.model().unwrap_or_default();
        if connector.eq_ignore_ascii_case(name) || model.eq_ignore_ascii_case(name) {
            return Some(monitor);
        }
    }
    None
}
