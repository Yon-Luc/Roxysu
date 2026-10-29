//! C-host workarounds W1–W5, each gated by [`crate::config::DiagnosticFlags`].
//! Default path leaves these off — WebKit already redraws on content change.

use gdk4::prelude::*;
use gtk4::gio;
use gtk4::prelude::*;
use gtk4::ApplicationWindow;
use gtk4_layer_shell::{Edge, Layer, LayerShell};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};
use tracing::{debug, info};
use webkit6::prelude::*;
use webkit6::WebView;

use crate::config::{Anchor, DiagnosticFlags};

const KEEPALIVE_JS: &str = r#"(function(){
if(document.getElementById('roxysu-keepalive'))return;
var s=document.createElement('style');s.id='roxysu-keepalive';
s.textContent='@keyframes roxsyuKa{from{opacity:.99998}to{opacity:1}}html{animation:roxsyuKa .2s linear infinite alternate}';
document.head.appendChild(s);})();"#;

fn eval_js(webview: &WebView, script: &str) {
    webview.evaluate_javascript(
        script,
        None,
        Some("roxysu-overlay"),
        None::<&gio::Cancellable>,
        |_| {},
    );
}

/// W5: soft page visibility (still pair with native map/unmap).
pub fn set_page_hidden(webview: &WebView, hidden: bool) {
    let js = if hidden {
        "document.documentElement.style.visibility='hidden';"
    } else {
        "document.documentElement.style.visibility='visible';"
    };
    eval_js(webview, js);
}

/// W2: permanent sub-visible CSS animation so WebKit keeps producing frames.
pub fn inject_keepalive(webview: &WebView) {
    eval_js(webview, KEEPALIVE_JS);
}

/// W3: bounce layer TOP → OVERLAY and re-apply anchors.
pub fn reassert_placement(window: &ApplicationWindow, anchor: Anchor) {
    let top = anchor.top();
    let left = anchor.left();
    window.set_anchor(Edge::Top, top);
    window.set_anchor(Edge::Bottom, !top);
    window.set_anchor(Edge::Left, left);
    window.set_anchor(Edge::Right, !left);
    window.set_layer(Layer::Top);
    window.set_layer(Layer::Overlay);
    window.queue_draw();
    debug!("reassert_placement");
}

/// Install W1 (damage tick) and/or W4 (paint counter + optional debug report).
pub fn install_timers(
    window: &ApplicationWindow,
    webview: &WebView,
    flags: DiagnosticFlags,
    debug: bool,
    mapped: Rc<RefCell<bool>>,
    shown: Rc<RefCell<bool>>,
) {
    if flags.damage_tick {
        info!("diag W1: damage_tick enabled (300ms opacity flip)");
        let window = window.clone();
        let webview = webview.clone();
        let mapped = Rc::clone(&mapped);
        let shown = Rc::clone(&shown);
        let flip = Rc::new(Cell::new(false));
        glib::timeout_add_local(Duration::from_millis(300), move || {
            if !*mapped.borrow() || !*shown.borrow() {
                return glib::ControlFlow::Continue;
            }
            flip.set(!flip.get());
            webview.set_opacity(if flip.get() { 1.0 } else { 0.999 });
            webview.queue_draw();
            if let Some(surface) = window.surface() {
                surface
                    .frame_clock()
                    .request_phase(gdk4::FrameClockPhase::PAINT);
            }
            glib::ControlFlow::Continue
        });
    }

    if flags.paint_counter {
        info!("diag W4: paint_counter tick callback enabled");
        let tick_count = Rc::new(Cell::new(0u32));
        let count_cb = Rc::clone(&tick_count);
        webview.add_tick_callback(move |_, _| {
            count_cb.set(count_cb.get().saturating_add(1));
            glib::ControlFlow::Continue
        });
        if debug {
            let mapped = Rc::clone(&mapped);
            let shown = Rc::clone(&shown);
            glib::timeout_add_local(Duration::from_secs(5), move || {
                let n = tick_count.replace(0);
                eprintln!(
                    "roxysu-overlay-rs: W4 ticks/5s={n} mapped={} shown={}",
                    *mapped.borrow() as u8,
                    *shown.borrow() as u8
                );
                glib::ControlFlow::Continue
            });
        }
    }

    // Phase 5: when --debug, count real frame-clock paint events (not ticks).
    if debug {
        install_frame_paint_stats(window, Rc::clone(&mapped), Rc::clone(&shown));
    }
}

fn install_frame_paint_stats(
    window: &ApplicationWindow,
    mapped: Rc<RefCell<bool>>,
    shown: Rc<RefCell<bool>>,
) {
    let armed = Rc::new(Cell::new(false));
    let window_weak = window.downgrade();
    // Attach once after the surface exists (map).
    window.connect_map(move |win| {
        if armed.get() {
            return;
        }
        let Some(surface) = win.surface() else {
            return;
        };
        armed.set(true);
        let paint_count = Rc::new(Cell::new(0u32));
        let count_cb = Rc::clone(&paint_count);
        surface.frame_clock().connect_paint(move |_| {
            count_cb.set(count_cb.get().saturating_add(1));
        });
        let mapped = Rc::clone(&mapped);
        let shown = Rc::clone(&shown);
        let window_weak = window_weak.clone();
        glib::timeout_add_local(Duration::from_secs(5), move || {
            let n = paint_count.replace(0);
            eprintln!(
                "roxysu-overlay-rs: frame_paints/5s={n} mapped={} shown={}",
                *mapped.borrow() as u8,
                *shown.borrow() as u8
            );
            if window_weak.upgrade().is_none() {
                return glib::ControlFlow::Break;
            }
            glib::ControlFlow::Continue
        });
    });
    info!("debug: frame-clock paint counter armed (reports every 5s after map)");
}

pub fn on_show(
    webview: &WebView,
    window: &ApplicationWindow,
    anchor: Anchor,
    flags: DiagnosticFlags,
) {
    if flags.reassert_placement {
        reassert_placement(window, anchor);
    }
    if flags.set_page_hidden {
        set_page_hidden(webview, false);
    }
    if flags.inject_keepalive {
        inject_keepalive(webview);
    }
}

pub fn on_hide(webview: &WebView, flags: DiagnosticFlags) {
    if flags.set_page_hidden {
        set_page_hidden(webview, true);
    }
}

pub fn on_refocus_while_shown(
    window: &ApplicationWindow,
    anchor: Anchor,
    flags: DiagnosticFlags,
    last_reassert: &Cell<Option<Instant>>,
) {
    if !flags.reassert_placement {
        return;
    }
    let now = Instant::now();
    let due = last_reassert
        .get()
        .map(|t| now.duration_since(t) >= Duration::from_secs(1))
        .unwrap_or(true);
    if due {
        reassert_placement(window, anchor);
        last_reassert.set(Some(now));
    }
}
