//! In-game style overlay HUD (fake telemetry).

use rune::tok::{self, motion, radius, space, type_};
use rune::{Color, Cx, El, col, el, text};

use crate::model::State;

pub fn view(s: &State, _: &mut Cx<State>) -> El {
    let dark = true;
    let accent = tok::accent(2, dark);
    let panel = Color {
        r: 0.04,
        g: 0.05,
        b: 0.07,
        a: 0.78,
    };
    let muted = Color {
        r: 0.72,
        g: 0.74,
        b: 0.78,
        a: 1.0,
    };

    el().w_full().h_full().child(
        col()
            .key("hud")
            .absolute(28.0, 28.0)
            .w(320.0)
            .padding(space::S3)
            .gap(space::S2)
            .radius(radius::LG)
            .fill(panel)
            .border(1.0, accent.alpha(0.35))
            .motion(motion::CALM)
            .child(
                el().w_full()
                    .h(3.0)
                    .radius(2.0)
                    .fill(accent)
                    .motion(motion::SNAPPY),
            )
            .child(
                text("Roxysu Play")
                    .font(type_::TITLE)
                    .color(Color::WHITE),
            )
            .child(
                text("HUD · click-through from Overlay tab")
                    .font(type_::LABEL)
                    .color(muted),
            )
            .child(
                text("")
                    .key("telemetry")
                    .font(type_::MONO_CAPTION)
                    .live_text(&s.shared.telemetry)
                    .color(accent),
            ),
    )
}
