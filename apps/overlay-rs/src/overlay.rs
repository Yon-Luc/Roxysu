use anyhow::{Context, Result};
use gdk4::prelude::*;
use gtk4::gio;
use gtk4::prelude::*;
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
use crate::focus::{
    self, visibility_after_unavailable, FocusCommand, FocusEvent, FocusHandle, OutputHint,
    OutputRect,
};
use crate::present::should_map_overlay;
use crate::reload::{ReloadMachine, ReloadTrigger, ScheduleResult};

/// Delay between unmapping and repinning a moved overlay. The hide must be
/// processed (surface destroyed) before `set_monitor`, so a short idle gap
/// is used rather than a same-iteration hide/show that GTK would coalesce.
const REPIN_DELAY: Duration = Duration::from_millis(30);

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
    /// Current WebView. Replaced wholesale after a web-process crash (D1),
    /// so every consumer must read the slot instead of holding a clone.
    webview: Rc<RefCell<WebView>>,
    /// Owns the WebView factory (D1). `OverlayHost` is consumed by
    /// `present_initial`, so a field there would be dropped too; the gate
    /// lives until app exit (the webview/message-handler cycle reaches it).
    /// The recreate timer looks the factory up here instead of holding its
    /// own weak reference, so the D1 recreate cannot silently no-op. This is
    /// a deliberate `gate → host → gate` cycle.
    webviews: RefCell<Option<Rc<WebViewHost>>>,
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

impl PageGate {
    fn webview(&self) -> WebView {
        self.webview.borrow().clone()
    }
}

pub struct OverlayHost {
    window: ApplicationWindow,
    config: Config,
    mapped: Rc<RefCell<bool>>,
    shown: Rc<RefCell<bool>>,
    click_method: Rc<RefCell<Option<ClickThroughMethod>>>,
    gate: Rc<PageGate>,
}

impl OverlayHost {
    pub fn new(app: &Application, config: Config) -> Result<Self> {
        // An explicit --output is resolved before any surface exists, so the
        // first map is already on the right monitor (D1/H2).
        let initial_monitor = match config.output.as_ref() {
            Some(name) => {
                let display = gdk4::Display::default().context("no GDK display")?;
                Some(
                    find_monitor_by_name(&display, name)
                        .with_context(|| format!("no output matches '{name}'"))?,
                )
            }
            None => None,
        };
        let (width, height) = config.surface_size(initial_monitor.as_ref().map(monitor_size));

        let window = ApplicationWindow::builder()
            .application(app)
            .title("Roxysu overlay")
            .default_width(width)
            .default_height(height)
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

        if let Some(ref monitor) = initial_monitor {
            window.set_monitor(Some(monitor));
            info!(
                output = %monitor_key(monitor),
                width,
                height,
                "pinned to monitor"
            );
        }

        let (webview, content) = build_webview();

        let mapped = Rc::new(RefCell::new(false));
        let shown = Rc::new(RefCell::new(false));
        let click_method = Rc::new(RefCell::new(None));

        {
            let mapped = Rc::clone(&mapped);
            let click_method = Rc::clone(&click_method);
            let surface_log_handlers = Rc::new(RefCell::new(SurfaceLogHandlers::default()));
            let window_weak = window.downgrade();
            window.connect_map(move |_| {
                *mapped.borrow_mut() = true;
                if let Some(window) = window_weak.upgrade() {
                    // D1 diagnosis: the negotiated surface size at the
                    // moment of mapping; the pin and layout logs carry the
                    // monitor and configure sides of the contract.
                    info!(
                        size = %format!("{}x{}", window.width(), window.height()),
                        scale = window.scale_factor(),
                        "overlay surface mapped"
                    );
                    wire_surface_logs(&window, &surface_log_handlers);
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

        // D1 diagnosis: the widget-level scale factor, and per-surface logs
        // wired on every map below.
        window.connect_scale_factor_notify(|window| {
            info!(scale = window.scale_factor(), "window scale factor changed");
        });

        let gate = Rc::new(PageGate {
            window: window.clone(),
            webview: Rc::new(RefCell::new(webview.clone())),
            webviews: RefCell::new(None),
            wants_visible: Cell::new(false),
            page_ready: Cell::new(false),
            shown: Rc::clone(&shown),
            opacity: config.opacity,
            anchor: config.anchor,
            diagnostics: config.diagnostics,
            ready_fallback: RefCell::new(None),
            reveal_fallback: RefCell::new(None),
        });
        let webviews = Rc::new(WebViewHost {
            window: window.clone(),
            url: config.url.clone(),
            gate: Rc::clone(&gate),
        });
        // Root the factory for the lifetime of the overlay (see the field
        // comment): OverlayHost is consumed by present_initial, so the gate
        // is the durable owner.
        *gate.webviews.borrow_mut() = Some(Rc::clone(&webviews));
        attach_webview(&webview, &content, &webviews);
        diagnostics::install_timers(
            &window,
            Rc::clone(&gate.webview),
            config.diagnostics,
            config.debug,
            Rc::clone(&mapped),
            Rc::clone(&shown),
        );

        Ok(Self {
            window,
            config,
            mapped,
            shown,
            click_method,
            gate,
        })
    }

    pub fn present_initial(
        self,
        focus_slot: &Rc<RefCell<Option<FocusHandle>>>,
        grant_fresh: bool,
    ) -> Result<()> {
        if self.config.list_windows {
            let (tx, rx) = mpsc::channel::<FocusEvent>();
            let policy = self.config.match_policy();
            std::thread::Builder::new()
                .name("overlay-focus".into())
                .spawn(move || {
                    if let Err(err) = focus::run_list_windows(tx, policy, grant_fresh) {
                        eprintln!("roxysu-overlay-rs: list-windows failed: {err:#}");
                    }
                })
                .context("spawn focus thread")?;
            // N1: after a fresh grant write the dump retries five times at
            // 200 ms, so give the whole attempt more than the plain 3 s.
            let timeout = if grant_fresh {
                Duration::from_secs(5)
            } else {
                Duration::from_secs(3)
            };
            match rx.recv_timeout(timeout) {
                Ok(FocusEvent::Dump(lines)) => {
                    eprintln!("roxysu-overlay-rs: known windows (focused=*):");
                    for line in lines {
                        eprintln!("  {line}");
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    warn!("timed out waiting for the toplevel dump")
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    warn!("focus thread exited before the toplevel dump (see list-windows error above)")
                }
            }
            if let Some(app) = self.window.application() {
                app.quit();
            }
            return Ok(());
        }

        if self.config.follow_focus {
            let handle = self.start_focus_tracking(grant_fresh)?;
            *focus_slot.borrow_mut() = Some(handle);
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
            let webview = self.gate.webview();
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

    fn start_focus_tracking(&self, grant_fresh: bool) -> Result<FocusHandle> {
        let (tx, rx) = focus::focus_queue();
        let handle = focus::spawn_focus_loop(self.config.match_policy(), tx, grant_fresh)?;

        let window = self.window.clone();
        let last = Rc::new(RefCell::new(None::<bool>));
        let last_reassert = Rc::new(Cell::new(None::<Instant>));
        // Bumped by every Show/Hide. A deferred unmap→pin→remap only runs
        // while its epoch is still current, so a newer command cancels it.
        let epoch = Rc::new(Cell::new(0u64));
        let diagnostics = self.config.diagnostics;
        let anchor = self.config.anchor;
        let hysteresis = self.config.hide_hysteresis_ms;
        let gate = Rc::clone(&self.gate);
        let lock_output = self.config.output.is_some();
        let pinned = Rc::new(RefCell::new(None::<String>));
        let mapped = Rc::clone(&self.mapped);
        let size_override = (self.config.width, self.config.height);

        glib::spawn_future_local(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    FocusCommand::Show { output } => {
                        // Cancel any pending hysteretic hide and any
                        // deferred unmap→pin→remap: this Show supersedes them.
                        let show_epoch = epoch.get().wrapping_add(1);
                        epoch.set(show_epoch);

                        // D1(a): when following osu!, never present before a
                        // usable output hint exists. With --output the pin is
                        // already fixed, so placement is always known.
                        let mut placeable = lock_output;
                        if !lock_output {
                            match output.as_ref() {
                                Some(hint) => match plan_pin(&window, hint, &pinned) {
                                    PinPlan::Unchanged => placeable = true,
                                    PinPlan::Move { monitor, key } => {
                                        placeable = true;
                                        if *gate.shown.borrow() || *mapped.borrow() {
                                            // D1(b): never set_monitor on a
                                            // live surface. Unmap, pin, and
                                            // remap on the fresh surface.
                                            unmap_then_repin(
                                                &gate,
                                                &pinned,
                                                &epoch,
                                                show_epoch,
                                                monitor,
                                                key,
                                                size_override,
                                            );
                                            *last.borrow_mut() = Some(true);
                                            continue;
                                        }
                                        apply_pin(
                                            &window,
                                            &monitor,
                                            &key,
                                            &pinned,
                                            size_override,
                                            *mapped.borrow(),
                                        );
                                    }
                                    PinPlan::Unresolved => {
                                        // Keep the last known pin if there is
                                        // one; otherwise fail closed.
                                        placeable = pinned.borrow().is_some();
                                    }
                                },
                                None => {
                                    // No hint yet (or the hinted output went
                                    // away). A previous pin still counts as a
                                    // known placement.
                                    placeable = pinned.borrow().is_some();
                                    if !placeable {
                                        info!(
                                            "focus: show without an output hint yet; \
                                             staying unmapped (fail-closed placement)"
                                        );
                                    }
                                }
                            }
                        }

                        if !placeable {
                            if gate.wants_visible.get() {
                                gate.wants_visible.set(false);
                                sync_gate(&gate);
                            }
                            *last.borrow_mut() = Some(false);
                            continue;
                        }

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
                        // Invalidate a pending deferred remap as well.
                        epoch.set(epoch.get().wrapping_add(1));
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
                        let hide_epoch = epoch.get();
                        let last = Rc::clone(&last);
                        let epoch = Rc::clone(&epoch);
                        let gate = Rc::clone(&gate);
                        glib::timeout_add_local_once(
                            Duration::from_millis(hysteresis),
                            move || {
                                if epoch.get() != hide_epoch {
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
                    FocusCommand::Unavailable { reason } => {
                        warn!(
                            %reason,
                            "focus protocol unavailable; staying unmapped \
                             (--follow-focus=false forces an always-visible layer)"
                        );
                        let next = visibility_after_unavailable(gate.wants_visible.get());
                        if next != gate.wants_visible.get() {
                            gate.wants_visible.set(next);
                            sync_gate(&gate);
                        }
                    }
                }
            }
        });

        Ok(handle)
    }
}

/// Everything a fresh `WebView` needs. A web-process crash recreates the
/// widget through this (D1): `load_uri` on the poisoned widget kept its
/// renderer/DMA-BUF state, so shear survived the reload.
struct WebViewHost {
    window: ApplicationWindow,
    url: String,
    gate: Rc<PageGate>,
}

impl WebViewHost {
    fn recreate(self: &Rc<Self>) -> WebView {
        info!(
            url = %self.url,
            "recreating webview after web-process termination"
        );
        let (webview, content) = build_webview();
        attach_webview(&webview, &content, self);
        webview
    }
}

/// Fresh WebView + content manager. The message handler name is registered
/// before the page can post; the handler itself is connected in
/// [`attach_webview`].
fn build_webview() -> (WebView, UserContentManager) {
    let content = UserContentManager::new();
    if !content.register_script_message_handler("roxysuOverlayReady", None) {
        warn!("failed to register roxysuOverlayReady; HUD will use the ready fallback");
    }
    let webview = WebView::builder().user_content_manager(&content).build();
    let transparent = gdk4::RGBA::new(0.0, 0.0, 0.0, 0.0);
    webview.set_background_color(&transparent);
    (webview, content)
}

/// Wire a built WebView into the window and the gate, then start loading.
fn attach_webview(webview: &WebView, content: &UserContentManager, host: &Rc<WebViewHost>) {
    {
        let gate = Rc::clone(&host.gate);
        content.connect_script_message_received(Some("roxysuOverlayReady"), move |_, _| {
            on_page_ready(&gate)
        });
    }
    wire_reload(webview, host);
    host.window.set_child(Some(webview));
    *host.gate.webview.borrow_mut() = webview.clone();
    webview.load_uri(&host.url);
}

/// What a scheduled reload does when its timer fires.
enum ReloadTarget {
    /// Load the URL again in the same widget (a failed network load).
    Load(glib::object::WeakRef<WebView>),
    /// Build a new WebView (a dead web process poisons the renderer). The
    /// gate owns the factory strongly, so the timer can always look it up.
    Recreate(Rc<PageGate>),
}

fn wire_reload(webview: &WebView, host: &Rc<WebViewHost>) {
    let machine = Rc::new(RefCell::new(ReloadMachine::new()));

    {
        let machine = Rc::clone(&machine);
        let gate = Rc::clone(&host.gate);
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
        let url = host.url.clone();
        let webview_weak = webview.downgrade();
        let gate = Rc::clone(&host.gate);
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
                ReloadTarget::Load(webview_weak.clone()),
            );
            // true = handled (suppress default error page if any)
            true
        });
    }

    {
        let machine = Rc::clone(&machine);
        let url = host.url.clone();
        let gate = Rc::clone(&host.gate);
        webview.connect_web_process_terminated(move |_, reason| {
            warn!(
                ?reason,
                shown = *gate.shown.borrow(),
                window_visible = gate.window.is_visible(),
                "webkit: web process terminated (crash/kill; distinct from HUD load-fail)"
            );
            on_navigation_started(&gate);
            schedule_reload(
                &machine,
                ReloadTrigger::WebProcessTerminated,
                &url,
                ReloadTarget::Recreate(Rc::clone(&gate)),
            );
        });
    }
}

fn schedule_reload(
    machine: &Rc<RefCell<ReloadMachine>>,
    trigger: ReloadTrigger,
    url: &str,
    target: ReloadTarget,
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
            let url = url.to_string();
            glib::timeout_add_local_once(delay, move || {
                machine.borrow_mut().on_timer_fired();
                match target {
                    ReloadTarget::Load(webview_weak) => {
                        if let Some(webview) = webview_weak.upgrade() {
                            info!(%url, "reloading webview");
                            webview.load_uri(&url);
                        }
                    }
                    ReloadTarget::Recreate(gate) => {
                        // The gate owns the factory for the overlay's
                        // lifetime (see `PageGate::webviews`).
                        let host = gate.webviews.borrow().as_ref().map(Rc::clone);
                        if let Some(host) = host {
                            host.recreate();
                        }
                    }
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
        if *gate_cb.shown.borrow() && gate_cb.page_ready.get() && gate_cb.wants_visible.get() {
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
            let webview = gate.webview();
            diagnostics::on_show(&webview, &gate.window, gate.anchor, gate.diagnostics);
        }
        arm_reveal(gate);
    } else if shown {
        info!("unmapping overlay so a reload cannot grey the playfield");
        cancel_source(&gate.reveal_fallback);
        gate.window.set_opacity(0.0);
        diagnostics::on_hide(&gate.webview(), gate.diagnostics);
        gate.window.set_visible(false);
        *gate.shown.borrow_mut() = false;
    }
}

/// D1 diagnosis: the layer-shell configure reaches GTK as
/// `GdkSurface::layout`, and a monitor move as `enter-monitor` /
/// `leave-monitor`.
///
/// GTK may hand the window a fresh surface after a map cycle, so re-wire on
/// every map. The stored `surface` is the object the handler ids belong to:
/// disconnecting from the *current* surface would leave the old handlers on
/// a stale surface.
#[derive(Default)]
struct SurfaceLogHandlers {
    surface: Option<gdk4::Surface>,
    layout: Option<glib::SignalHandlerId>,
    enter_monitor: Option<glib::SignalHandlerId>,
    leave_monitor: Option<glib::SignalHandlerId>,
}

fn wire_surface_logs(window: &ApplicationWindow, handlers: &RefCell<SurfaceLogHandlers>) {
    let Some(surface) = gtk4::prelude::NativeExt::surface(window) else {
        return;
    };
    let mut slot = handlers.borrow_mut();
    if let Some(previous) = slot.surface.take() {
        for id in [
            slot.layout.take(),
            slot.enter_monitor.take(),
            slot.leave_monitor.take(),
        ]
        .into_iter()
        .flatten()
        {
            previous.disconnect(id);
        }
    }
    slot.layout = Some(surface.connect_layout(|_, width, height| {
        info!(width, height, "surface layout (layer-shell configure)");
    }));
    slot.enter_monitor = Some(surface.connect_enter_monitor(|_, monitor| {
        info!(monitor = %monitor_label(&monitor), "surface entered monitor");
    }));
    slot.leave_monitor = Some(surface.connect_leave_monitor(|_, monitor| {
        info!(monitor = %monitor_label(&monitor), "surface left monitor");
    }));
    slot.surface = Some(surface);
}

/// Connector / model / geometry / scale for the surface monitor logs.
fn monitor_label(monitor: &gdk4::Monitor) -> String {
    let geometry = monitor.geometry();
    format!(
        "connector='{}' model='{}' {}x{}+{}+{} scale={}",
        monitor.connector().unwrap_or_default(),
        monitor.model().unwrap_or_default(),
        geometry.width(),
        geometry.height(),
        geometry.x(),
        geometry.y(),
        monitor.scale()
    )
}

/// What the current hint means for the surface pin.
enum PinPlan {
    /// The surface is already on the hinted output.
    Unchanged,
    /// The pin must move to this monitor.
    Move { monitor: gdk4::Monitor, key: String },
    /// The hint did not resolve to a `GdkMonitor` (warned).
    Unresolved,
}

/// Explicit `--output` wins and is resolved in [`OverlayHost::new`].
/// Otherwise the hint is resolved and compared with the current pin so a
/// repeat `set_monitor` (and a needless surface recreate) is skipped.
fn plan_pin(
    window: &ApplicationWindow,
    hint: &OutputHint,
    pinned: &RefCell<Option<String>>,
) -> PinPlan {
    let display = gtk4::prelude::WidgetExt::display(window);
    let Some(monitor) = monitor_for_hint(&display, hint) else {
        warn!(?hint, "osu! output not found among Gdk monitors");
        return PinPlan::Unresolved;
    };
    let key = monitor_key(&monitor);
    if pinned.borrow().as_deref() == Some(key.as_str()) {
        return PinPlan::Unchanged;
    }
    PinPlan::Move { monitor, key }
}

/// Apply a pin while the surface is unmapped, plus the D1 before/after log.
fn apply_pin(
    window: &ApplicationWindow,
    monitor: &gdk4::Monitor,
    key: &str,
    pinned: &RefCell<Option<String>>,
    size_override: (Option<i32>, Option<i32>),
    mapped: bool,
) {
    let from = pinned.borrow().clone();
    window.set_monitor(Some(monitor));
    *pinned.borrow_mut() = Some(key.to_string());
    let geometry = monitor.geometry();
    info!(
        output = %key,
        from = ?from,
        mapped,
        monitor_geometry = %format!(
            "{}x{}+{}+{}",
            geometry.width(),
            geometry.height(),
            geometry.x(),
            geometry.y()
        ),
        monitor_scale = monitor.scale(),
        "pinned overlay to osu! output"
    );
    size_to_monitor(window, monitor, size_override);
}

/// D1(b): an output change on a live surface becomes unmap → `set_monitor`
/// → remap. `gtk_layer_set_monitor` remaps a mapped window itself, which is
/// exactly the surface recreate that could shear the next buffer; doing it
/// while unmapped keeps the sequence explicit. The brief flicker is the
/// accepted cost.
#[allow(clippy::too_many_arguments)]
fn unmap_then_repin(
    gate: &Rc<PageGate>,
    pinned: &Rc<RefCell<Option<String>>>,
    epoch: &Rc<Cell<u64>>,
    show_epoch: u64,
    monitor: gdk4::Monitor,
    key: String,
    size_override: (Option<i32>, Option<i32>),
) {
    info!(output = %key, "unmapping overlay before repinning to a new output");
    gate.wants_visible.set(false);
    sync_gate(gate);

    let gate = Rc::clone(gate);
    let pinned = Rc::clone(pinned);
    let epoch = Rc::clone(epoch);
    glib::timeout_add_local_once(REPIN_DELAY, move || {
        if epoch.get() != show_epoch {
            return; // a newer Show/Hide superseded this move
        }
        apply_pin(&gate.window, &monitor, &key, &pinned, size_override, false);
        gate.wants_visible.set(true);
        sync_gate(&gate);
    });
}

fn monitor_size(monitor: &gdk4::Monitor) -> (i32, i32) {
    let geometry = monitor.geometry();
    (geometry.width(), geometry.height())
}

/// Size the layer-surface request to the pinned monitor when no explicit
/// `--width`/`--height` was given (L2). All four edges are anchored, so the
/// compositor's configure remains authoritative; this only sets the size the
/// surface starts from, clamped so it can never exceed the output.
fn size_to_monitor(
    window: &ApplicationWindow,
    monitor: &gdk4::Monitor,
    size_override: (Option<i32>, Option<i32>),
) {
    if size_override.0.is_some() && size_override.1.is_some() {
        return;
    }
    let (width, height) = crate::config::compute_surface_size(
        Some(monitor_size(monitor)),
        size_override.0,
        size_override.1,
    );
    window.set_default_size(width, height);
    info!(width, height, "sized overlay request to the pinned output");
}

fn monitor_for_hint(display: &gdk4::Display, hint: &OutputHint) -> Option<gdk4::Monitor> {
    match hint {
        OutputHint::Name(name) => find_monitor_by_name(display, name),
        OutputHint::Rect(rect) => find_monitor_for_rect(display, rect),
    }
}

fn monitor_key(monitor: &gdk4::Monitor) -> String {
    let connector = monitor.connector().unwrap_or_default();
    if !connector.is_empty() {
        return connector.to_string();
    }
    monitor.model().unwrap_or_default().to_string()
}

fn find_monitor_for_rect(display: &gdk4::Display, rect: &OutputRect) -> Option<gdk4::Monitor> {
    let cx = rect.x.saturating_add(rect.width / 2);
    let cy = rect.y.saturating_add(rect.height / 2);
    let monitors = display.monitors();
    let n = monitors.n_items();
    let mut best: Option<(gdk4::Monitor, i64)> = None;
    for i in 0..n {
        let Some(monitor) = monitors
            .item(i)
            .and_then(|o| o.downcast::<gdk4::Monitor>().ok())
        else {
            continue;
        };
        let g = monitor.geometry();
        if cx >= g.x() && cy >= g.y() && cx < g.x() + g.width() && cy < g.y() + g.height() {
            return Some(monitor);
        }
        let area = overlap_area(
            (rect.x, rect.y, rect.width, rect.height),
            (g.x(), g.y(), g.width(), g.height()),
        );
        if area > 0 && best.as_ref().map(|(_, prev)| area > *prev).unwrap_or(true) {
            best = Some((monitor, area));
        }
    }
    best.map(|(monitor, _)| monitor)
}

fn overlap_area(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> i64 {
    let x1 = a.0.max(b.0);
    let y1 = a.1.max(b.1);
    let x2 = (a.0.saturating_add(a.2)).min(b.0.saturating_add(b.2));
    let y2 = (a.1.saturating_add(a.3)).min(b.1.saturating_add(b.3));
    let w = (x2 - x1).max(0) as i64;
    let h = (y2 - y1).max(0) as i64;
    w.saturating_mul(h)
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
