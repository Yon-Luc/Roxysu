use anyhow::{Context, Result};
use gdk4::prelude::*;
use gtk4::prelude::*;
use gtk4::{Application, ApplicationWindow};
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tracing::{info, warn};
use webkit6::prelude::*;
use webkit6::{LoadEvent, WebView};

use crate::click_through::{apply_click_through, ClickThroughMethod};
use crate::config::Config;
use crate::diagnostics;
use crate::focus::{self, FocusCommand, FocusEvent};
use crate::reload::{ReloadMachine, ReloadTrigger, ScheduleResult};

pub struct OverlayHost {
    window: ApplicationWindow,
    webview: WebView,
    config: Config,
    mapped: Rc<RefCell<bool>>,
    shown: Rc<RefCell<bool>>,
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
        let shown = Rc::new(RefCell::new(false));
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

        wire_reload(&webview, &config.url);
        diagnostics::install_timers(
            &window,
            &webview,
            config.diagnostics,
            config.debug,
            Rc::clone(&mapped),
            Rc::clone(&shown),
        );

        Ok(Self {
            window,
            webview,
            config,
            mapped,
            shown,
            click_method,
        })
    }

    pub fn present_initial(self) -> Result<()> {
        if self.config.list_windows {
            let (tx, rx) = mpsc::channel::<FocusEvent>();
            let policy = self.config.match_policy();
            std::thread::Builder::new()
                .name("overlay-focus".into())
                .spawn(move || {
                    if let Err(err) = focus::run_list_windows(tx, policy) {
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
            self.apply_show();
            info!("follow-focus disabled; always visible");
        }

        if self.config.test_hide_show {
            let window = self.window.clone();
            let webview = self.webview.clone();
            let mapped = Rc::clone(&self.mapped);
            let shown = Rc::clone(&self.shown);
            let click_method = Rc::clone(&self.click_method);
            let diagnostics = self.config.diagnostics;
            let anchor = self.config.anchor;
            glib::timeout_add_local_once(Duration::from_secs(2), move || {
                info!("test-hide-show: hiding");
                diagnostics::on_hide(&webview, diagnostics);
                window.set_visible(false);
                *shown.borrow_mut() = false;
                let window2 = window.clone();
                let webview2 = webview.clone();
                let mapped = Rc::clone(&mapped);
                let shown = Rc::clone(&shown);
                let click_method = Rc::clone(&click_method);
                glib::timeout_add_local_once(Duration::from_millis(500), move || {
                    info!("test-hide-show: showing again");
                    window2.set_visible(true);
                    window2.present();
                    *shown.borrow_mut() = true;
                    diagnostics::on_show(&webview2, &window2, anchor, diagnostics);
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

    fn apply_show(&self) {
        self.window.set_visible(true);
        self.window.present();
        *self.shown.borrow_mut() = true;
        diagnostics::on_show(
            &self.webview,
            &self.window,
            self.config.anchor,
            self.config.diagnostics,
        );
    }

    fn start_focus_tracking(&self) -> Result<()> {
        let (tx, rx) = async_channel::unbounded::<FocusCommand>();

        let policy = self.config.match_policy();
        std::thread::Builder::new()
            .name("overlay-focus".into())
            .spawn(move || {
                if let Err(err) = focus::run_focus_loop(policy, tx) {
                    eprintln!("roxysu-overlay-rs: focus thread exited: {err:#}");
                }
            })
            .context("spawn focus thread")?;

        let window = self.window.clone();
        let webview = self.webview.clone();
        let shown = Rc::clone(&self.shown);
        let last = Rc::new(RefCell::new(None::<bool>));
        let last_reassert = Rc::new(Cell::new(None::<Instant>));
        let hide_epoch = Rc::new(Cell::new(0u64));
        let diagnostics = self.config.diagnostics;
        let anchor = self.config.anchor;
        let hysteresis = self.config.hide_hysteresis_ms;

        glib::spawn_future_local(async move {
            while let Ok(cmd) = rx.recv().await {
                match cmd {
                    FocusCommand::Show => {
                        // Cancel any pending hysteretic hide.
                        hide_epoch.set(hide_epoch.get().wrapping_add(1));
                        let was_shown = *last.borrow() == Some(true);
                        if !was_shown {
                            info!("focus: show");
                            window.set_visible(true);
                            window.present();
                            *shown.borrow_mut() = true;
                            diagnostics::on_show(&webview, &window, anchor, diagnostics);
                            *last.borrow_mut() = Some(true);
                        } else {
                            diagnostics::on_refocus_while_shown(
                                &window,
                                anchor,
                                diagnostics,
                                &last_reassert,
                            );
                        }
                    }
                    FocusCommand::Hide => {
                        if *last.borrow() == Some(false) {
                            continue;
                        }
                        if hysteresis == 0 {
                            info!("focus: hide");
                            diagnostics::on_hide(&webview, diagnostics);
                            window.set_visible(false);
                            *shown.borrow_mut() = false;
                            *last.borrow_mut() = Some(false);
                            continue;
                        }
                        let epoch = hide_epoch.get().wrapping_add(1);
                        hide_epoch.set(epoch);
                        let window = window.clone();
                        let webview = webview.clone();
                        let shown = Rc::clone(&shown);
                        let last = Rc::clone(&last);
                        let hide_epoch = Rc::clone(&hide_epoch);
                        glib::timeout_add_local_once(
                            Duration::from_millis(hysteresis),
                            move || {
                                if hide_epoch.get() != epoch {
                                    return; // cancelled by Show
                                }
                                if *last.borrow() == Some(false) {
                                    return;
                                }
                                info!(hysteresis_ms = hysteresis, "focus: hide");
                                diagnostics::on_hide(&webview, diagnostics);
                                window.set_visible(false);
                                *shown.borrow_mut() = false;
                                *last.borrow_mut() = Some(false);
                            },
                        );
                    }
                    FocusCommand::Disconnected => {
                        warn!("focus tracking disconnected; leaving visibility unchanged");
                    }
                    FocusCommand::Unavailable => {
                        warn!(
                            "foreign-toplevel unavailable; falling back to always-visible \
                             (same as --follow-focus false)"
                        );
                        hide_epoch.set(hide_epoch.get().wrapping_add(1));
                        if *last.borrow() != Some(true) {
                            window.set_visible(true);
                            window.present();
                            *shown.borrow_mut() = true;
                            diagnostics::on_show(&webview, &window, anchor, diagnostics);
                            *last.borrow_mut() = Some(true);
                        }
                    }
                }
            }
        });

        Ok(())
    }
}

fn wire_reload(webview: &WebView, url: &str) {
    let machine = Rc::new(RefCell::new(ReloadMachine::new()));
    let url = Rc::new(url.to_string());

    {
        let machine = Rc::clone(&machine);
        webview.connect_load_changed(move |_, event| {
            if event == LoadEvent::Finished {
                machine.borrow_mut().on_load_finished();
                info!("webkit: load finished");
            }
        });
    }

    {
        let machine = Rc::clone(&machine);
        let url = Rc::clone(&url);
        let webview_weak = webview.downgrade();
        webview.connect_load_failed(move |_, _event, failing_uri, error| {
            warn!(
                failing_uri,
                error = %error,
                "webkit: load failed"
            );
            schedule_reload(
                &machine,
                ReloadTrigger::LoadFailed,
                &url,
                &webview_weak,
            );
            // true = handled (suppress default error page if any)
            true
        });
    }

    {
        let machine = Rc::clone(&machine);
        let url = Rc::clone(&url);
        let webview_weak = webview.downgrade();
        webview.connect_web_process_terminated(move |_, reason| {
            warn!(?reason, "webkit: web process terminated");
            schedule_reload(
                &machine,
                ReloadTrigger::WebProcessTerminated,
                &url,
                &webview_weak,
            );
        });
    }
}

fn schedule_reload(
    machine: &Rc<RefCell<ReloadMachine>>,
    trigger: ReloadTrigger,
    url: &Rc<String>,
    webview_weak: &glib::object::WeakRef<WebView>,
) {
    let result = machine.borrow_mut().on_trigger(trigger);
    match result {
        ScheduleResult::AlreadyPending => {
            info!(?trigger, "reload already pending; ignoring");
        }
        ScheduleResult::Schedule { delay } => {
            let failures = machine.borrow().consecutive_load_failures();
            info!(?trigger, ?delay, failures, "scheduling webview reload");
            let machine = Rc::clone(machine);
            let url = Rc::clone(url);
            let webview_weak = webview_weak.clone();
            glib::timeout_add_local_once(delay, move || {
                machine.borrow_mut().on_timer_fired();
                if let Some(webview) = webview_weak.upgrade() {
                    info!(%url, "reloading webview");
                    webview.load_uri(&url);
                }
            });
        }
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
