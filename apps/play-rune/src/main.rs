//! Roxysu Play — isolated Rune overlay prototype.
//!
//! Proves transparent / topmost / click-through overlays with a control window and a
//! coalesced fake telemetry feed. Does not replace the GPUIX app in `apps/play`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rune::tok::{self, type_};
use rune::{
    AppSpec, Color, Cx, El, LiveText, Waker, WindowHandle, WindowOptions, WindowSpec, col, el, text,
};

/// Framework-neutral snapshot of what the UI shows.
#[derive(Clone, Debug)]
struct AppSnapshot {
    tick: u64,
    status: String,
    overlay_visible: bool,
    click_through: bool,
}

/// Framework-neutral commands from the control window.
#[derive(Clone, Copy, Debug)]
enum AppCommand {
    SetOverlayVisible(bool),
    SetClickThrough(bool),
}

/// Shared handles and coalesced telemetry (latest-wins via [`LiveText`]).
#[derive(Clone)]
struct Shared {
    overlays: Arc<Mutex<Vec<WindowHandle>>>,
    telemetry: LiveText,
    tick: Arc<Mutex<u64>>,
    overlay_visible: Arc<AtomicBool>,
    click_through: Arc<AtomicBool>,
}

impl Shared {
    fn new() -> Self {
        Self {
            overlays: Arc::new(Mutex::new(Vec::new())),
            telemetry: LiveText::new("tick=0 · waiting"),
            tick: Arc::new(Mutex::new(0)),
            overlay_visible: Arc::new(AtomicBool::new(true)),
            click_through: Arc::new(AtomicBool::new(true)),
        }
    }

    fn snapshot(&self) -> AppSnapshot {
        let tick = *self.tick.lock().expect("tick lock");
        AppSnapshot {
            tick,
            status: self.telemetry.get().to_string(),
            overlay_visible: self.overlay_visible.load(Ordering::Relaxed),
            click_through: self.click_through.load(Ordering::Relaxed),
        }
    }

    fn apply(&self, command: AppCommand) {
        match command {
            AppCommand::SetOverlayVisible(visible) => {
                self.overlay_visible.store(visible, Ordering::Relaxed);
                let overlays = self.overlays.lock().expect("overlays lock");
                for window in overlays.iter() {
                    if visible {
                        window.show();
                    } else {
                        window.hide();
                    }
                }
            }
            AppCommand::SetClickThrough(click_through) => {
                self.click_through.store(click_through, Ordering::Relaxed);
                let overlays = self.overlays.lock().expect("overlays lock");
                for window in overlays.iter() {
                    if let Err(error) = window.set_click_through(click_through) {
                        eprintln!("click-through: {error}");
                    }
                }
            }
        }
    }

    fn publish_tick(&self, tick: u64) {
        *self.tick.lock().expect("tick lock") = tick;
        // Latest-wins: LiveText replaces prior text; no queue of visual updates.
        self.telemetry
            .set(format!("tick={tick} · fake telemetry ok"));
    }
}

struct State {
    /// True for per-display overlay windows; false for the control window.
    overlay: bool,
    shared: Shared,
    /// Control-window mirrors so presses re-run the view and refresh labels.
    overlay_visible: bool,
    click_through: bool,
}

impl Drop for State {
    fn drop(&mut self) {
        if !self.overlay {
            for window in self.shared.overlays.lock().expect("overlays lock").iter() {
                window.close();
            }
        }
    }
}

fn dummy_init() -> State {
    State {
        overlay: false,
        shared: Shared::new(),
        overlay_visible: true,
        click_through: true,
    }
}

fn control_state(shared: Shared) -> State {
    let snap = shared.snapshot();
    State {
        overlay: false,
        overlay_visible: snap.overlay_visible,
        click_through: snap.click_through,
        shared,
    }
}

fn overlay_state(shared: Shared) -> State {
    let snap = shared.snapshot();
    State {
        overlay: true,
        overlay_visible: snap.overlay_visible,
        click_through: snap.click_through,
        shared,
    }
}

fn button(label: &'static str, fill: Color) -> El {
    el().key(label)
        .padding(12.0)
        .radius(8.0)
        .fill(fill)
        .child(text(label).font(type_::BODY).color(Color::WHITE))
}

fn control_view(s: &State, _: &mut Cx<State>) -> El {
    let t = tok::theme(true);
    let snap = s.shared.snapshot();
    let accent = tok::accent(0, true);
    let danger = Color {
        r: 0.75,
        g: 0.25,
        b: 0.3,
        a: 1.0,
    };

    let visibility_label = if s.overlay_visible {
        "Hide overlay"
    } else {
        "Show overlay"
    };
    let click_label = if s.click_through {
        "Disable click-through"
    } else {
        "Enable click-through"
    };

    col()
        .w_full()
        .h_full()
        .padding(28.0)
        .gap(16.0)
        .fill(t.bg)
        .child(
            text("Roxysu Play — Rune prototype")
                .font(type_::TITLE)
                .color(t.text),
        )
        .child(
            text("Control window · fake telemetry · WindowOptions::overlay")
                .font(type_::BODY)
                .color(t.text_secondary),
        )
        .child(
            text(format!(
                "overlay_visible={} · click_through={} · tick={} · {}",
                s.overlay_visible, s.click_through, snap.tick, snap.status
            ))
            .font(type_::BODY)
            .color(t.text),
        )
        .child(
            text("")
                .key("status")
                .font(type_::BODY)
                .live_text(&s.shared.telemetry)
                .color(t.text),
        )
        .child(
            button(visibility_label, accent).on_press(|s: &mut State| {
                let next = !s.overlay_visible;
                s.overlay_visible = next;
                s.shared.apply(AppCommand::SetOverlayVisible(next));
            }),
        )
        .child(
            button(click_label, if s.click_through { danger } else { accent }).on_press(
                |s: &mut State| {
                    let next = !s.click_through;
                    s.click_through = next;
                    s.shared.apply(AppCommand::SetClickThrough(next));
                },
            ),
        )
}

fn overlay_view(s: &State, _: &mut Cx<State>) -> El {
    let panel = Color {
        r: 0.05,
        g: 0.08,
        b: 0.12,
        a: 0.72,
    };
    let accent = tok::accent(0, true);

    el().w_full().h_full().child(
        col()
            .key("hud")
            .absolute(24.0, 24.0)
            .padding(16.0)
            .gap(8.0)
            .radius(12.0)
            .fill(panel)
            .child(
                text("Roxysu Play HUD")
                    .font(type_::TITLE)
                    .color(Color::WHITE),
            )
            .child(
                text("")
                    .key("telemetry")
                    .font(type_::BODY)
                    .live_text(&s.shared.telemetry)
                    .color(accent),
            )
            .child(
                text("transparent · topmost · click-through via control")
                    .font(type_::BODY)
                    .color(Color {
                        r: 0.75,
                        g: 0.78,
                        b: 0.85,
                        a: 1.0,
                    }),
            ),
    )
}

fn view(s: &State, cx: &mut Cx<State>) -> El {
    if s.overlay {
        overlay_view(s, cx)
    } else {
        control_view(s, cx)
    }
}

fn start_fake_telemetry(shared: Shared, wake: Waker) {
    std::thread::Builder::new()
        .name("fake-telemetry".into())
        .spawn(move || {
            let start = Instant::now();
            let mut tick: u64 = 0;
            loop {
                tick = tick.wrapping_add(1);
                // Coalesce: only the latest tick string is stored.
                shared.publish_tick(tick);
                // Wake UI without doing layout/render on this thread.
                wake();
                let target = start + Duration::from_millis(100 * tick);
                let now = Instant::now();
                if target > now {
                    std::thread::sleep(target - now);
                }
            }
        })
        .expect("spawn fake telemetry");
}

fn setup(s: &mut State, wake: Waker) {
    if s.overlay {
        return;
    }
    start_fake_telemetry(s.shared.clone(), wake);
}

fn control_spec() -> AppSpec<State> {
    AppSpec {
        setup: Some(setup),
        ..AppSpec::new(
            "Roxysu Play (Rune control)",
            (480.0, 360.0),
            dummy_init,
            view,
        )
    }
}

fn overlay_spec() -> AppSpec<State> {
    AppSpec::new(
        "Roxysu Play (Rune overlay)",
        (800.0, 600.0),
        dummy_init,
        view,
    )
}

fn main() {
    rune::run_windows(|displays| {
        let shared = Shared::new();
        let mut windows = vec![WindowSpec::new("controls", control_spec())
            .state(control_state(shared.clone()))];

        if displays.is_empty() {
            eprintln!("play-rune: no displays reported; control window only");
        }

        for (i, display) in displays.iter().enumerate() {
            let handles = shared.overlays.clone();
            windows.push(
                WindowSpec::new(format!("overlay-{i}"), overlay_spec())
                    .state(overlay_state(shared.clone()))
                    .options(WindowOptions::overlay(display))
                    .on_created(move |window| {
                        eprintln!(
                            "play-rune: overlay-{i} ready (window_number={:?})",
                            window.window_number()
                        );
                        let _ = window.set_click_through(true);
                        handles.lock().expect("overlays lock").push(window);
                    }),
            );
        }

        windows
    });
}
