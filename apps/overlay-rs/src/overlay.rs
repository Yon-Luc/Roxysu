use anyhow::{Context, Result};
use gdk4::prelude::*;
use gtk4::prelude::*;
use gtk4::gio;
use gtk4::{Application, ApplicationWindow};
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tracing::{info, warn};
use webkit6::prelude::*;
use webkit6::{LoadEvent, UserContentManager, WebView};

use crate::click_through::{apply_click_through, ClickThroughMethod};
use crate::config::Config;
use crate::diagnostics;
use crate::focus::{self, FocusCommand, FocusEvent};
use crate::present::should_map_overlay;
use crate::reload::{ReloadMachine, ReloadTrigger, ScheduleResult};

/// Hide the first presents after map. WebKit's initial buffer on a newly
/// mapped transparent view is often opaque grey; window opacity covers that
/// even when the compositor ignores a later opacity-only hide.
const REVEAL_DELAY: Duration = Duration::from_millis(50);
/// If the page never posts ready (script error), still show the HUD.
const READY_FALLBACK: Duration = Duration::from_millis(1500);

const PAGE_READY_JS: &str = r#"(function(){
  try {
    var path = (location.hash || "").replace(/^#/, "").split("?")[0];
    if (path === "/overlay") {
      document.documentElement.classList.add("overlay-mode");
      document.documentElement.style.background = "transparent";
      if (document.body) document.body.style.background = "transparent";
    }
  } catch (e) {}
  var raf = window.requestAnimationFrame || function(cb){ cb(); };
  raf(function(){ raf(function(){
    try { window.webkit.messageHandlers.roxysuOverlayReady.postMessage("ready"); } catch (e) {}
  }); });
})();"#;

struct PageGate {
    window: ApplicationWindow,
    webview: WebView,
    /// Focus policy (or always-visible fallback) wants the surface up.
    wants_visible: Cell<bool>,
    /// Page posted a transparent frame, or the fallback fired.
    page_ready: Cell<bool>,
    shown: Rc<RefCell<bool>>,
    opacity: f64,
    anchor: crate::config::Anchor,
    diagnostics: crate::config::DiagnosticFlags,
    ready_fallback: RefCell<Option<glib::SourceId>>,
    reveal_fallback: RefCell<Option<glib::SourceId>>,
}

pub struct OverlayHost {
    window: ApplicationWindow,
    webview: WebView,
    config: Config,
    mapped: Rc<RefCell<bool>>,
    shown: Rc<RefCell<bool>>,
    click_method: Rc<RefCell<Option<ClickThroughMethod>>>,
    gate: Rc<PageGate>,
}

impl OverlayHost {
    pub fn new(app: &Application, config: Config) -> Result<Self> {
        let window = ApplicationWindow::builder()
            .application(app)
            .title("Roxysu overlay")
            .default_width(config.width)
            .default_height(config.height)
            .build();
        // Stay invisible until a transparent frame exists. A mapped WebKit
        // surface clears to opaque grey and covers the playfield.
        window.set_opacity(0.0);
        window.set_visible(false);

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

        let content = UserContentManager::new();
        if !content.register_script_message_handler("roxysuOverlayReady", None) {
            warn!("failed to register roxysuOverlayReady; HUD will use the ready fallback");
        }
        let webview = WebView::builder()
            .user_content_manager(&content)
            .build();
        let transparent = gdk4::RGBA::new(0.0, 0.0, 0.0, 0.0);
        webview.set_background_color(&transparent);
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

        let gate = Rc::new(PageGate {
            window: window.clone(),
            webview: webview.clone(),
            wants_visible: Cell::new(false),
            page_ready: Cell::new(false),
            shown: Rc::clone(&shown),
            opacity: config.opacity,
            anchor: config.anchor,
            diagnostics: config.diagnostics,
            ready_fallback: RefCell::new(None),
            reveal_fallback: RefCell::new(None),
        });
        {
            let gate = Rc::clone(&gate);
            content.connect_script_message_received(
                Some("roxysuOverlayReady"),
                move |_, _| on_page_ready(&gate),
            );
        }
        wire_reload(&webview, &config.url, Rc::clone(&gate));
        webview.load_uri(&config.url);
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
            gate,
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
            self.gate.wants_visible.set(true);
            sync_gate(&self.gate);
            info!("follow-focus disabled; always visible once the page is transparent");
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
        let last = Rc::new(RefCell::new(None::<bool>));
        let last_reassert = Rc::new(Cell::new(None::<Instant>));
        let hide_epoch = Rc::new(Cell::new(0u64));
        let diagnostics = self.config.diagnostics;
        let anchor = self.config.anchor;
        let hysteresis = self.config.hide_hysteresis_ms;
        let gate = Rc::clone(&self.gate);

        glib::spawn_future_local(async move {
            while let Ok(cmd) = rx.recv().await {
                match cmd {
                    FocusCommand::Show => {
                        // Cancel any pending hysteretic hide.
                        hide_epoch.set(hide_epoch.get().wrapping_add(1));
                        let was_shown = *last.borrow() == Some(true);
                        if !was_shown {
                            info!("focus: show");
                            gate.wants_visible.set(true);
                            sync_gate(&gate);
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
                            gate.wants_visible.set(false);
                            sync_gate(&gate);
                            *last.borrow_mut() = Some(false);
                            continue;
                        }
                        let epoch = hide_epoch.get().wrapping_add(1);
                        hide_epoch.set(epoch);
                        let last = Rc::clone(&last);
                        let hide_epoch = Rc::clone(&hide_epoch);
                        let gate = Rc::clone(&gate);
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
                                gate.wants_visible.set(false);
                                sync_gate(&gate);
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
                            gate.wants_visible.set(true);
                            sync_gate(&gate);
                            *last.borrow_mut() = Some(true);
                        }
                    }
                }
            }
        });

        Ok(())
    }
}

fn wire_reload(webview: &WebView, url: &str, gate: Rc<PageGate>) {
    let machine = Rc::new(RefCell::new(ReloadMachine::new()));
    let url = Rc::new(url.to_string());

    {
        let machine = Rc::clone(&machine);
        let gate = Rc::clone(&gate);
        let webview_weak = webview.downgrade();
        webview.connect_load_changed(move |_, event| {
            if event == LoadEvent::Started {
                // A navigation (including our own reload) discards the
                // transparent frame. Unmap until the next ready signal.
                on_navigation_started(&gate);
            }
            if event == LoadEvent::Finished {
                machine.borrow_mut().on_load_finished();
                info!("webkit: load finished");
                if let Some(webview) = webview_weak.upgrade() {
                    request_page_ready(&webview, &gate);
                }
            }
        });
    }

    {
        let machine = Rc::clone(&machine);
        let url = Rc::clone(&url);
        let webview_weak = webview.downgrade();
        let gate = Rc::clone(&gate);
        webview.connect_load_failed(move |_, _event, failing_uri, error| {
            on_navigation_started(&gate);
            warn!(
                failing_uri,
                error = %error,
                "webkit: load failed (likely HUD/server unreachable; not a web-process crash)"
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
        let gate = Rc::clone(&gate);
        webview.connect_web_process_terminated(move |_, reason| {
            warn!(?reason, "webkit: web process terminated (crash/kill; distinct from HUD load-fail)");
            on_navigation_started(&gate);
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

fn on_navigation_started(gate: &Rc<PageGate>) {
    gate.page_ready.set(false);
    cancel_source(&gate.ready_fallback);
    cancel_source(&gate.reveal_fallback);
    gate.window.set_opacity(0.0);
    sync_gate(gate);
}

fn on_page_ready(gate: &Rc<PageGate>) {
    if gate.page_ready.get() {
        return;
    }
    gate.page_ready.set(true);
    cancel_source(&gate.ready_fallback);
    info!("page ready; overlay may map");
    sync_gate(gate);
}

fn request_page_ready(webview: &WebView, gate: &Rc<PageGate>) {
    webview.evaluate_javascript(
        PAGE_READY_JS,
        None,
        Some("roxysu-overlay"),
        None::<&gio::Cancellable>,
        |_| {},
    );
    arm_ready_fallback(gate);
}

fn arm_ready_fallback(gate: &Rc<PageGate>) {
    cancel_source(&gate.ready_fallback);
    let gate_cb = Rc::clone(gate);
    let id = glib::timeout_add_local(READY_FALLBACK, move || {
        gate_cb.ready_fallback.borrow_mut().take();
        if !gate_cb.page_ready.get() {
            warn!("page-ready signal missing; mapping after fallback");
            gate_cb.page_ready.set(true);
            sync_gate(&gate_cb);
        }
        glib::ControlFlow::Break
    });
    *gate.ready_fallback.borrow_mut() = Some(id);
}

fn arm_reveal(gate: &Rc<PageGate>) {
    cancel_source(&gate.reveal_fallback);
    let gate_cb = Rc::clone(gate);
    let id = glib::timeout_add_local(REVEAL_DELAY, move || {
        gate_cb.reveal_fallback.borrow_mut().take();
        if *gate_cb.shown.borrow() && gate_cb.page_ready.get() && gate_cb.wants_visible.get()
        {
            gate_cb.window.set_opacity(gate_cb.opacity);
            info!("overlay revealed");
        }
        glib::ControlFlow::Break
    });
    *gate.reveal_fallback.borrow_mut() = Some(id);
}

fn cancel_source(slot: &RefCell<Option<glib::SourceId>>) {
    if let Some(id) = slot.borrow_mut().take() {
        id.remove();
    }
}

fn sync_gate(gate: &Rc<PageGate>) {
    let map = should_map_overlay(gate.wants_visible.get(), gate.page_ready.get());
    let shown = *gate.shown.borrow();
    if map {
        if !shown {
            info!("mapping overlay after transparent frame");
            gate.window.set_opacity(0.0);
            gate.window.set_visible(true);
            gate.window.present();
            *gate.shown.borrow_mut() = true;
            diagnostics::on_show(
                &gate.webview,
                &gate.window,
                gate.anchor,
                gate.diagnostics,
            );
        }
        arm_reveal(gate);
    } else if shown {
        info!("unmapping overlay so a reload cannot grey the playfield");
        cancel_source(&gate.reveal_fallback);
        gate.window.set_opacity(0.0);
        diagnostics::on_hide(&gate.webview, gate.diagnostics);
        gate.window.set_visible(false);
        *gate.shown.borrow_mut() = false;
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
