//! Silent mania playfield + results — CPU raster presented via Pixels or NativeSurface.

use std::sync::atomic::Ordering;

use rune::tok::{self, radius, space, type_};
use rune::{
    Align, Color, Cx, Drag, El, Phase as DragPhase, PhysicalInput, PhysicalKeyCode, SurfaceFit, Tx,
    col, el, row, text,
};

use crate::gameplay::{InputEvent, InputKind};
use crate::keybinds;
use crate::model::{Phase, PlayResult, PlaySession, PresentSink, State};
use crate::settings::{HIT_POS_STEP, SCALE_STEP, SCROLL_STEP};

fn playfield_stage(session: &PlaySession) -> El {
    let (dw, dh) = session.display_size();
    let mut stage = el()
        .key("stage")
        .size(dw, dh)
        .radius(radius::MD)
        .live_offset(&session.offset);
    stage = match session.sink {
        PresentSink::Pixels => stage.pixels_fit(&session.field, SurfaceFit::Fill),
        PresentSink::NativeSurface => stage.native_surface(&session.surface, SurfaceFit::Fill),
    };
    if !session.layout_edit {
        return stage;
    }
    stage
        .border(
            1.0,
            Color {
                r: 1.0,
                g: 0.75,
                b: 0.2,
                a: 0.85,
            },
        )
        .on_drag(|st: &mut State, drag: &mut Drag, _tx: &mut Tx| {
            let Phase::Playing(session) = &mut st.phase else {
                return;
            };
            if !session.layout_edit {
                return;
            }
            match drag.phase {
                DragPhase::Down => session.begin_layout_drag(),
                DragPhase::Move => {
                    if !drag.cancelled() {
                        session.apply_layout_drag(drag.dx, drag.dy);
                    }
                }
                DragPhase::Up => {
                    if drag.cancelled() {
                        if let Some(origin) = session.drag_origin_peek() {
                            session.offset.set(origin);
                        }
                    } else {
                        session.apply_layout_drag(drag.dx, drag.dy);
                    }
                    session.end_layout_drag();
                }
            }
        })
}

pub fn playing_view(s: &State, session: &PlaySession, cx: &mut Cx<State>) -> El {
    let dark = true;
    let accent = tok::accent(2, dark);
    let t = tok::theme(dark);
    let _ = cx;
    let fullscreen = s.shared.is_fullscreen();
    let keys_hint = session.bindings_hint();

    col()
        .key("play")
        .w_full()
        .h_full()
        .fill(t.bg)
        .center()
        .gap(space::S3)
        .focusable(true)
        .on_physical_input(|st: &mut State, event: &PhysicalInput, _: &mut Tx| {
            let Phase::Playing(session) = &mut st.phase else {
                return false;
            };
            let PhysicalInput::Key {
                key,
                pressed,
                repeat,
                ..
            } = event
            else {
                return false;
            };
            if *repeat {
                return true;
            }
            if *pressed {
                if *key == PhysicalKeyCode::KeyP {
                    session.toggle_sink();
                    return true;
                }
                if *key == PhysicalKeyCode::BracketLeft || *key == PhysicalKeyCode::Minus {
                    session.nudge_scroll(-SCROLL_STEP);
                    return true;
                }
                if *key == PhysicalKeyCode::BracketRight || *key == PhysicalKeyCode::Equal {
                    session.nudge_scroll(SCROLL_STEP);
                    return true;
                }
                if *key == PhysicalKeyCode::KeyI {
                    session.toggle_skin();
                    return true;
                }
                if *key == PhysicalKeyCode::KeyO {
                    session.nudge_scale(-SCALE_STEP);
                    return true;
                }
                if *key == PhysicalKeyCode::KeyU {
                    session.nudge_scale(SCALE_STEP);
                    return true;
                }
                if *key == PhysicalKeyCode::Comma {
                    session.nudge_hit_position(-HIT_POS_STEP);
                    return true;
                }
                if *key == PhysicalKeyCode::Period {
                    session.nudge_hit_position(HIT_POS_STEP);
                    return true;
                }
                if *key == PhysicalKeyCode::F2 {
                    session.toggle_layout_edit();
                    return true;
                }
                if *key == PhysicalKeyCode::F11 {
                    st.shared.toggle_fullscreen();
                    return true;
                }
            }
            let Some(lane) = keybinds::lane_for_physical(*key, &session.lane_keys) else {
                return false;
            };
            let time = session.song_time_ms();
            let idx = lane as usize;
            if *pressed {
                if session.keys_down[idx] {
                    return true;
                }
                session.keys_down[idx] = true;
                session.pending_inputs.push(InputEvent {
                    lane,
                    time_ms: time,
                    kind: InputKind::Press,
                });
            } else {
                if !session.keys_down[idx] {
                    return true;
                }
                session.keys_down[idx] = false;
                session.pending_inputs.push(InputEvent {
                    lane,
                    time_ms: time,
                    kind: InputKind::Release,
                });
            }
            true
        })
        .child(
            text(session.title.clone())
                .font(type_::TITLE)
                .color(t.text),
        )
        .child(
            text("100.0%  ·  9999x  ·  score 9999999  ·  999999ms")
                .key("hud")
                .font(type_::BODY)
                .live_text(&session.hud_line)
                .color(t.text_secondary),
        )
        .child(
            text("999 fps · raster 99.99ms · set 99.99ms · NativeSurface · P sink")
                .key("perf")
                .font(type_::MONO_CAPTION)
                .live_text(&session.perf_line)
                .color(accent),
        )
        .child(
            text("scroll 1200 · scale 200% · hit 95% · skin:WWWWWWWWWWWW · layout:edit")
                .key("meta")
                .font(type_::MONO_CAPTION)
                .live_text(&session.meta_line)
                .color(t.text_secondary),
        )
        .child(
            text("rss 9999MB · cpu 999% · nvidia 9999MB · audio WWWWWWWWWWWWWWWWWW")
                .key("res")
                .font(type_::MONO_CAPTION)
                .live_text(&session.res_line)
                .color(t.text_secondary),
        )
        .child(
            text("PERFECT")
                .key("judge")
                .font(type_::TITLE)
                .live_text(&session.judge_line)
                .color(accent),
        )
        .child(playfield_stage(session))
        .child(
            row()
                .gap(space::S2)
                .center_y()
                .child(toolbar_btn(
                    accent,
                    t,
                    if fullscreen { "Windowed" } else { "Fullscreen" },
                    |st: &mut State| {
                        st.shared.toggle_fullscreen();
                    },
                ))
                .child(toolbar_btn(
                    accent,
                    t,
                    if session.layout_edit {
                        "Lock layout"
                    } else {
                        "Edit layout"
                    },
                    |st: &mut State| {
                        if let Phase::Playing(session) = &mut st.phase {
                            session.toggle_layout_edit();
                        }
                    },
                ))
                .child(toolbar_btn(accent, t, "Size −", |st: &mut State| {
                    if let Phase::Playing(session) = &mut st.phase {
                        session.nudge_scale(-SCALE_STEP);
                    }
                }))
                .child(toolbar_btn(accent, t, "Size +", |st: &mut State| {
                    if let Phase::Playing(session) = &mut st.phase {
                        session.nudge_scale(SCALE_STEP);
                    }
                })),
        )
        .child(
            text(format!(
                "{keys_hint}  ·  [ ] scroll  ·  U/O size  ·  ,/. hit  ·  F2 layout  ·  F11 fullscreen  ·  Esc"
            ))
            .font(type_::LABEL)
            .color(t.text_secondary)
            .align(Align::Center),
        )
}

fn toolbar_btn(
    accent: Color,
    t: tok::Theme,
    label: &'static str,
    on_press: impl Fn(&mut State) + 'static,
) -> El {
    el().h(32.0)
        .px(space::S3)
        .center()
        .radius(radius::SM)
        .fill(accent.alpha(0.22))
        .hover(accent.alpha(0.4))
        .press(t.press)
        .focusable(true)
        .on_press(on_press)
        .child(text(label).font(type_::LABEL).color(Color::WHITE))
}

pub fn results_view(result: &PlayResult) -> El {
    let dark = true;
    let accent = tok::accent(2, dark);
    let t = tok::theme(dark);
    let s = &result.snapshot;
    col()
        .key("results")
        .w_full()
        .h_full()
        .fill(t.bg)
        .center()
        .gap(space::S3)
        .padding(space::S6)
        .child(text("Results").font(type_::TITLE).color(t.text))
        .child(text(result.title.clone()).font(type_::BODY).color(t.text_secondary))
        .child(
            text(format!("{:.2}% accuracy", s.accuracy * 100.0))
                .font(type_::TITLE)
                .color(accent),
        )
        .child(
            text(format!(
                "score {}  ·  combo {} (max {})",
                s.score, s.combo, s.max_combo
            ))
            .font(type_::BODY)
            .color(t.text),
        )
        .child(
            text(format!(
                "P{} G{} G{} O{} M{} X{}",
                s.counts.perfect,
                s.counts.great,
                s.counts.good,
                s.counts.ok,
                s.counts.meh,
                s.counts.miss
            ))
            .font(type_::MONO_CAPTION)
            .color(t.text_secondary),
        )
        .child(
            el().key("back")
                .h(44.0)
                .w(220.0)
                .center()
                .radius(radius::MD)
                .fill(accent)
                .focusable(true)
                .on_press(|st: &mut State| {
                    if let Phase::Playing(session) = &mut st.phase {
                        session.sync_settings_into(&mut st.settings);
                        session.stop_audio();
                    }
                    st.phase = Phase::Shell;
                    st.tab = crate::model::ShellTab::Library;
                    st.playing.store(false, Ordering::Relaxed);
                })
                .child(text("Back to library").font(type_::BODY).color(Color::WHITE)),
        )
}
