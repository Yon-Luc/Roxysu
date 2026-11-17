//! Automated overlay API acceptance smoke (`--acceptance-smoke`).

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::model::{AppCommand, Shared};

pub fn wait_overlays(shared: &Shared, timeout: Duration) -> usize {
    let deadline = Instant::now() + timeout;
    loop {
        let n = shared.overlays.lock().expect("overlays lock").len();
        if n > 0 || Instant::now() >= deadline {
            return n;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub fn run_acceptance_smoke(shared: Shared) {
    std::thread::Builder::new()
        .name("acceptance-smoke".into())
        .spawn(move || {
            let mut failed = false;
            let overlay_count = wait_overlays(&shared, Duration::from_secs(8));
            if overlay_count == 0 {
                eprintln!(
                    "ACCEPTANCE_SMOKE fail overlays=0 (timeout waiting for WindowOptions::overlay)"
                );
                failed = true;
            } else {
                eprintln!("ACCEPTANCE_SMOKE pass overlays={overlay_count}");
            }

            let tick0 = shared.snapshot().tick;
            std::thread::sleep(Duration::from_millis(450));
            let tick1 = shared.snapshot().tick;
            if tick1 > tick0 {
                eprintln!("ACCEPTANCE_SMOKE pass telemetry tick {tick0} -> {tick1}");
            } else {
                eprintln!("ACCEPTANCE_SMOKE fail telemetry stuck at {tick0}");
                failed = true;
            }

            shared.apply(AppCommand::SetClickThrough(false));
            let err_off = shared.click_through_error.lock().expect("error lock").clone();
            if err_off.is_empty() && !shared.click_through.load(Ordering::Relaxed) {
                eprintln!("ACCEPTANCE_SMOKE pass click_through=false (API)");
            } else {
                eprintln!(
                    "ACCEPTANCE_SMOKE fail click_through=false err={err_off:?} flag={}",
                    shared.click_through.load(Ordering::Relaxed)
                );
                failed = true;
            }

            shared.apply(AppCommand::SetClickThrough(true));
            let err_on = shared.click_through_error.lock().expect("error lock").clone();
            if err_on.is_empty() && shared.click_through.load(Ordering::Relaxed) {
                eprintln!("ACCEPTANCE_SMOKE pass click_through=true (API)");
            } else {
                eprintln!(
                    "ACCEPTANCE_SMOKE fail click_through=true err={err_on:?} flag={}",
                    shared.click_through.load(Ordering::Relaxed)
                );
                failed = true;
            }

            shared.apply(AppCommand::SetOverlayVisible(false));
            std::thread::sleep(Duration::from_millis(200));
            if !shared.overlay_visible.load(Ordering::Relaxed) {
                eprintln!("ACCEPTANCE_SMOKE pass overlay_visible=false (API hide)");
            } else {
                eprintln!("ACCEPTANCE_SMOKE fail overlay_visible=false");
                failed = true;
            }

            shared.apply(AppCommand::SetOverlayVisible(true));
            std::thread::sleep(Duration::from_millis(200));
            if shared.overlay_visible.load(Ordering::Relaxed) {
                eprintln!("ACCEPTANCE_SMOKE pass overlay_visible=true (API show)");
            } else {
                eprintln!("ACCEPTANCE_SMOKE fail overlay_visible=true");
                failed = true;
            }

            if failed {
                eprintln!("ACCEPTANCE_SMOKE RESULT fail");
            } else {
                eprintln!("ACCEPTANCE_SMOKE RESULT pass");
            }

            if let Some(control) = shared.control.lock().expect("control lock").clone() {
                control.close();
            } else {
                eprintln!("ACCEPTANCE_SMOKE warn control handle missing; exiting process");
                std::process::exit(if failed { 1 } else { 0 });
            }
        })
        .expect("spawn acceptance smoke");
}
