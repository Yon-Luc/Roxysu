//! Roxysu Play — Rune shell with local-mirror library + mania play slice.
//!
//! Does not replace GPUIX `apps/play`. Overlay + acceptance smoke remain available.
//!
//! Flags:
//! - `--snap path.png --window controls`
//! - `--acceptance-smoke`

mod audio;
mod catalog;
mod chart;
mod gameplay;
mod hud;
mod judge;
mod keybinds;
mod model;
mod paths;
mod play_view;
mod playfield_raster;
mod resources;
mod settings;
mod shell;
mod skin;
mod smoke;

use std::time::{Duration, Instant};

use rune::{AppSpec, Cx, El, Key, KeyEvent, Tx, Waker, WindowOptions, WindowSpec};

use model::{Phase, PlayResult, Shared, State, control_state, dummy_init, overlay_state};
use smoke::run_acceptance_smoke;

fn view(s: &State, cx: &mut Cx<State>) -> El {
    if s.overlay {
        return hud::view(s, cx);
    }
    match &s.phase {
        Phase::Shell => shell::view(s, cx),
        Phase::Playing(session) => play_view::playing_view(s, session, cx),
        Phase::Results(result) => play_view::results_view(result),
    }
}

fn start_fake_telemetry(shared: Shared, wake: Waker) {
    std::thread::Builder::new()
        .name("fake-telemetry".into())
        .spawn(move || {
            let start = Instant::now();
            let mut tick: u64 = 0;
            loop {
                // Don't fight the playfield for wake/frame budget.
                if shared.playing.load(std::sync::atomic::Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                }
                tick = tick.wrapping_add(1);
                shared.publish_tick(tick);
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
    if std::env::args().any(|a| a == "--acceptance-smoke") {
        run_acceptance_smoke(s.shared.clone());
    }
}

fn poll(s: &mut State, _: f64, tx: &mut Tx) -> bool {
    if s.overlay {
        return false;
    }
    match &mut s.phase {
        Phase::Playing(session) => {
            let (snap, dirty) = session.tick();
            if snap.finished {
                let title = session.title.clone();
                session.sync_settings_into(&mut s.settings);
                session.stop_audio();
                s.playing.store(false, std::sync::atomic::Ordering::Relaxed);
                s.phase = Phase::Results(PlayResult {
                    title,
                    snapshot: snap,
                });
                return true;
            }
            // Keep the clock advancing; rebuild only when the present sink toggles.
            tx.wake_after(Duration::ZERO);
            dirty
        }
        _ => false,
    }
}

fn on_key(s: &mut State, event: &KeyEvent, _tx: &mut Tx) -> bool {
    if s.overlay {
        return false;
    }
    if matches!(event.key, Key::Escape) {
        if s.rebinding_lane.take().is_some() {
            s.settings_hint = "rebinding cancelled".into();
            return true;
        }
        match &s.phase {
            Phase::Playing(_) | Phase::Results(_) => {
                if let Phase::Playing(session) = &mut s.phase {
                    session.sync_settings_into(&mut s.settings);
                    session.stop_audio();
                }
                s.playing.store(false, std::sync::atomic::Ordering::Relaxed);
                s.phase = Phase::Shell;
                return true;
            }
            Phase::Shell => {}
        }
    }
    false
}

fn control_spec() -> AppSpec<State> {
    AppSpec {
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(on_key),
        ..AppSpec::new("Roxysu Play", (1100.0, 720.0), dummy_init, view)
    }
}

fn overlay_spec() -> AppSpec<State> {
    AppSpec::new("Roxysu Play HUD", (800.0, 600.0), dummy_init, view)
}

fn wants_acceptance_smoke() -> bool {
    std::env::args().any(|a| a == "--acceptance-smoke")
}

fn main() {
    eprintln!(
        "play-rune: local mirror {} · osu data {}",
        paths::local_mirror_path().display(),
        paths::osu_data_path().display()
    );

    rune::run_windows(move |displays| {
        let shared = Shared::new();
        if let Some(primary) = displays.iter().find(|d| d.primary).or_else(|| displays.first())
        {
            let bounds = primary.native_bounds();
            shared.set_display_size((bounds[2] as f32, bounds[3] as f32));
        }
        let control_handles = shared.control.clone();
        let mut windows = vec![WindowSpec::new("controls", control_spec())
            .state(control_state(shared.clone()))
            .on_created(move |window| {
                *control_handles.lock().expect("control lock") = Some(window);
            })];

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

        if wants_acceptance_smoke() && displays.is_empty() {
            eprintln!("ACCEPTANCE_SMOKE fail no displays for overlay");
        }

        windows
    });
}
