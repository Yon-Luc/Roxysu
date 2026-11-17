//! Play-like control shell — local-mirror library + overlay controls.

use rune::tok::{self, Theme, motion, radius, space, type_};
use rune::{
    Align, Color, Cx, El, GrowthSpec, PhysicalInput, PhysicalKeyCode, ScrollSpec, Tx, col, el, row,
    text,
};

use crate::audio::Music;
use crate::catalog::BeatmapRow;
use crate::chart::load_chart_from_hash;
use crate::gameplay::GameplayEngine;
use crate::keybinds;
use crate::model::{AppCommand, Phase, PlaySession, ShellTab, State};
use crate::paths::{lazer_file_path, osu_data_path};
use crate::settings::{
    HIT_POS_STEP, OFFSET_STEP, SCALE_STEP, SCROLL_STEP,
};

#[derive(Clone, Copy)]
struct Paint {
    t: Theme,
    accent: Color,
    hair: f32,
}

fn paint(cx: &Cx<State>) -> Paint {
    let dark = true;
    Paint {
        t: tok::theme(dark),
        accent: tok::accent(2, dark), // pink — closer to osu! than default blue
        hair: 1.0 / cx.env().scale,
    }
}

pub fn view(s: &State, cx: &mut Cx<State>) -> El {
    let p = paint(cx);
    row()
        .key("shell")
        .w_full()
        .h_full()
        .fill(p.t.bg)
        .focusable(true)
        .on_physical_input(|st: &mut State, event: &PhysicalInput, _: &mut Tx| {
            handle_shell_physical(st, event)
        })
        .child(nav_rail(s, p))
        .child(el().w(p.hair).h_full().fill(p.t.separator))
        .child(
            col()
                .key("main")
                .grow(1.0)
                .min_h(0.0)
                .min_w(0.0)
                .child(match s.tab {
                    ShellTab::Library => library_page(s, p),
                    ShellTab::Settings => settings_page(s, p),
                    ShellTab::Overlay => overlay_page(s, p),
                    ShellTab::About => about_page(p),
                }),
        )
}

fn handle_shell_physical(s: &mut State, event: &PhysicalInput) -> bool {
    let PhysicalInput::Key {
        key,
        pressed,
        repeat,
        ..
    } = event
    else {
        return false;
    };
    if *repeat || !*pressed {
        return false;
    }
    if *key == PhysicalKeyCode::F11 {
        s.shared.toggle_fullscreen();
        return true;
    }
    let Some(lane) = s.rebinding_lane else {
        return false;
    };
    if matches!(
        *key,
        PhysicalKeyCode::Escape | PhysicalKeyCode::F11 | PhysicalKeyCode::F2
    ) {
        return false;
    }
    let Some(name) = keybinds::name_from_physical(*key) else {
        s.settings_hint = format!("unsupported key {key:?}");
        return true;
    };
    match s.settings.set_lane_key(lane, name) {
        Ok(()) => {
            s.settings_hint = format!(
                "lane {} → {}",
                lane + 1,
                keybinds::format_key_label(name)
            );
            s.rebinding_lane = None;
        }
        Err(err) => {
            s.settings_hint = err;
        }
    }
    true
}

fn nav_rail(s: &State, p: Paint) -> El {
    let rail_bg = Color {
        r: 0.06,
        g: 0.07,
        b: 0.09,
        a: 1.0,
    };
    col()
        .key("nav")
        .w(200.0)
        .h_full()
        .px(space::S3)
        .pt(space::S6)
        .pb(space::S6)
        .gap(space::S2)
        .fill(rail_bg)
        .child(
            col()
                .gap(space::S1)
                .child(
                    text("Roxysu")
                        .font(type_::SECTION)
                        .color(p.t.text_secondary),
                )
                .child(text("Play").font(type_::TITLE).color(p.t.text))
                .child(
                    text("Rune shell")
                        .font(type_::LABEL)
                        .color(p.accent),
                ),
        )
        .child(el().h(space::S6))
        .child(nav_item(p, "Library", ShellTab::Library, s.tab))
        .child(nav_item(p, "Settings", ShellTab::Settings, s.tab))
        .child(nav_item(p, "Overlay", ShellTab::Overlay, s.tab))
        .child(nav_item(p, "About", ShellTab::About, s.tab))
        .child(el().grow(1.0))
        .child(
            text("GPUIX app unchanged")
                .font(type_::LABEL)
                .color(p.t.text_secondary),
        )
}

fn nav_item(p: Paint, label: &'static str, tab: ShellTab, current: ShellTab) -> El {
    let selected = tab == current;
    el().key(label)
        .h(40.0)
        .w_full()
        .px(space::S3)
        .radius(radius::MD)
        .center_y()
        .fill(if selected {
            p.accent.alpha(0.18)
        } else {
            Color::TRANSPARENT
        })
        .hover(p.t.hover)
        .press(p.t.press)
        .motion(motion::SNAPPY)
        .focusable(true)
        .on_press(move |s: &mut State| s.tab = tab)
        .child(
            text(label)
                .font(type_::BODY)
                .color(if selected { p.t.text } else { p.t.text_secondary }),
        )
}

fn library_page(s: &State, p: Paint) -> El {
    let map = s.catalog.get(s.selected).cloned();
    col()
        .key("library")
        .grow(1.0)
        .min_h(0.0)
        .px(space::S6)
        .pt(space::S6)
        .pb(space::S6)
        .gap(space::S3)
        .child(page_header(
            p,
            "Song select",
            "Read-only local mirror · mania 7K · silent play slice",
        ))
        .child(availability_card(s, p))
        .child(
            row()
                .key("split")
                .grow(1.0)
                .min_h(0.0)
                .gap(space::S3)
                .child(beatmap_list(s, p))
                .child(detail_panel(s, p, map)),
        )
}

fn page_header(p: Paint, title: &'static str, subtitle: &'static str) -> El {
    col()
        .gap(space::S1)
        .child(text(title).font(type_::TITLE).color(p.t.text))
        .child(text(subtitle).font(type_::BODY).color(p.t.text_secondary))
}

fn availability_card(s: &State, p: Paint) -> El {
    let st = &s.catalog_status;
    let badge = if st.ok { "ready" } else { "unavailable" };
    let badge_fill = if st.ok { p.accent } else { p.t.control_off };
    row()
        .key("availability")
        .w_full()
        .px(space::S3)
        .py(space::S3)
        .gap(space::S3)
        .center_y()
        .radius(radius::LG)
        .fill(p.t.card)
        .border(p.hair, p.t.card_border)
        .child(pill(p, badge, badge_fill))
        .child(
            col()
                .gap(2.0)
                .grow(1.0)
                .child(text("Local mirror").font(type_::BODY).color(p.t.text))
                .child(
                    text(st.message.clone())
                        .font(type_::LABEL)
                        .color(p.t.text_secondary),
                )
                .child(
                    text(st.db_path.clone())
                        .font(type_::MONO_CAPTION)
                        .color(p.t.text_secondary),
                ),
        )
        .child(pill(p, "7K", p.t.control_off))
}

fn pill(_p: Paint, label: &'static str, fill: Color) -> El {
    el().padding(space::S2)
        .px(space::S3)
        .radius(radius::SM)
        .fill(fill)
        .child(text(label).font(type_::LABEL).color(Color::WHITE))
}

fn beatmap_list(s: &State, p: Paint) -> El {
    let n = s.catalog.len();
    let _ = p; // row builder reconstructs theme (virtual_rows only gets &State)
    col()
        .key("list-pane")
        .grow(1.2)
        .min_h(0.0)
        .min_w(0.0)
        .child(
            col()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .grow(1.0)
                .min_h(0.0)
                .child(
                    col()
                        .key("rows")
                        .w_full()
                        .growth(GrowthSpec::default())
                        .virtual_rows(
                            n,
                            64.0,
                            |_: &State, i| format!("map-{i}").into(),
                            |st: &State, i| {
                                let row_paint = Paint {
                                    t: tok::theme(true),
                                    accent: tok::accent(2, true),
                                    hair: 1.0,
                                };
                                beatmap_row(st, row_paint, i, &st.catalog[i])
                            },
                        ),
                ),
        )
}

fn beatmap_row(s: &State, p: Paint, index: usize, map: &BeatmapRow) -> El {
    let selected = s.selected == index;
    row()
        .key(format!("map-{index}"))
        .w_full()
        .px(space::S3)
        .py(space::S3)
        .gap(space::S3)
        .center_y()
        .radius(radius::MD)
        .fill(if selected {
            p.accent.alpha(0.14)
        } else {
            p.t.card
        })
        .border(
            p.hair,
            if selected {
                p.accent.alpha(0.55)
            } else {
                p.t.card_border
            },
        )
        .hover(p.t.hover)
        .press(p.t.press)
        .motion(motion::SNAPPY)
        .focusable(true)
        .on_press(move |s: &mut State| {
            s.selected = index;
            s.start_hint.clear();
        })
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(2.0)
                .child(text(map.title.clone()).font(type_::BODY).color(p.t.text))
                .child(
                    text(format!("{} · {}", map.artist, map.difficulty))
                        .font(type_::LABEL)
                        .color(p.t.text_secondary),
                ),
        )
        .child(
            col()
                .gap(2.0)
                .child(
                    text(format!("{:.1}★", map.stars))
                        .font(type_::MONO_CAPTION)
                        .color(p.accent)
                        .align(Align::End),
                )
                .child(
                    text(format!("{}K", map.keys))
                        .font(type_::LABEL)
                        .color(p.t.text_secondary)
                        .align(Align::End),
                ),
        )
}

fn detail_panel(s: &State, p: Paint, map: Option<BeatmapRow>) -> El {
    let Some(map) = map else {
        return col()
            .key("detail")
            .grow(0.9)
            .min_h(0.0)
            .padding(space::S6)
            .radius(radius::LG)
            .fill(p.t.card)
            .border(p.hair, p.t.card_border)
            .child(text("Select a beatmap").color(p.t.text_secondary));
    };

    let keys_label: &'static str = if map.keys == 7 { "7K" } else { "4K" };

    col()
        .key("detail")
        .grow(0.9)
        .min_h(0.0)
        .padding(space::S6)
        .gap(space::S3)
        .radius(radius::LG)
        .fill(p.t.card)
        .border(p.hair, p.t.card_border)
        .child(
            el().w_full()
                .h(4.0)
                .radius(2.0)
                .fill(p.accent)
                .motion(motion::CALM),
        )
        .child(text(map.title.clone()).font(type_::TITLE).color(p.t.text))
        .child(text(map.artist.clone()).font(type_::BODY).color(p.t.text_secondary))
        .child(
            row()
                .gap(space::S2)
                .child(
                    el().padding(space::S2)
                        .px(space::S3)
                        .radius(radius::SM)
                        .fill(p.t.control_off)
                        .child(
                            text(map.difficulty.clone())
                                .font(type_::LABEL)
                                .color(Color::WHITE),
                        ),
                )
                .child(pill(p, keys_label, p.accent.alpha(0.85))),
        )
        .child(
            text(format!(
                "{:.2}★ · OD {:.1} · {:.0}s · hash {}…",
                map.stars,
                map.overall_difficulty,
                map.length_ms / 1000.0,
                map.hash.get(..8).unwrap_or(&map.hash)
            ))
            .font(type_::BODY)
            .color(p.t.text_secondary),
        )
        .child(
            text(format!(
                "scroll {:.0} px/s · {}",
                s.settings.scroll_speed, s.settings.skin_status
            ))
            .font(type_::LABEL)
            .color(p.t.text_secondary),
        )
        .child(
            row()
                .gap(space::S2)
                .child(settings_btn(p, "−spd", |s| {
                    s.settings.nudge_scroll(-SCROLL_STEP);
                }))
                .child(settings_btn(p, "+spd", |s| {
                    s.settings.nudge_scroll(SCROLL_STEP);
                }))
                .child(settings_btn(p, "skin on/off", |s| {
                    if s.settings.skin.is_none() {
                        s.start_hint = s.settings.skin_status.clone();
                    } else {
                        s.settings.use_skin = !s.settings.use_skin;
                        s.start_hint = s.settings.skin_mode_label();
                    }
                }))
                .child(settings_btn(p, "reload skin", |s| {
                    match crate::skin::load_preferred() {
                        Ok(skin) => {
                            let status = format!(
                                "loaded {} ({} notes)",
                                skin.name,
                                skin.note_count()
                            );
                            s.settings.set_skin(Some(skin), status.clone());
                            s.settings.use_skin = true;
                            s.start_hint = status;
                        }
                        Err(err) => {
                            s.settings.set_skin(None, err.clone());
                            s.start_hint = err;
                        }
                    }
                })),
        )
        .child(el().grow(1.0))
        .child(
            text(if s.start_hint.is_empty() {
                "Start · in play: [ ] scroll · I skin A/B · P present sink".to_string()
            } else {
                s.start_hint.clone()
            })
            .font(type_::LABEL)
            .color(p.t.text_secondary),
        )
        .child(
            el().key("start")
                .h(44.0)
                .w_full()
                .center()
                .radius(radius::MD)
                .fill(p.accent)
                .hover(p.accent.alpha(0.85))
                .press(p.t.press)
                .motion(motion::SNAPPY)
                .focusable(true)
                .on_press(|s: &mut State| start_selected(s))
                .child(text("Start").font(type_::BODY).color(Color::WHITE)),
        )
}

fn settings_btn(p: Paint, label: impl Into<String>, on_press: impl Fn(&mut State) + 'static) -> El {
    let label = label.into();
    el().h(32.0)
        .px(space::S3)
        .center()
        .radius(radius::SM)
        .fill(p.t.control_off)
        .hover(p.accent.alpha(0.35))
        .focusable(true)
        .on_press(on_press)
        .child(text(label).font(type_::LABEL).color(Color::WHITE))
}

fn settings_page(s: &State, p: Paint) -> El {
    let keys = &s.settings.lane_keys;
    let rebinding = s.rebinding_lane;
    let fullscreen = s.shared.is_fullscreen();
    col()
        .key("settings")
        .grow(1.0)
        .min_h(0.0)
        .px(space::S6)
        .pt(space::S6)
        .pb(space::S6)
        .gap(space::S3)
        .child(page_header(
            p,
            "Settings",
            "Playfield size, layout, keybinds, fullscreen — session only (not persisted yet)",
        ))
        .child(
            col()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .grow(1.0)
                .min_h(0.0)
                .gap(space::S3)
                .child(settings_section(
                    p,
                    "Playfield",
                    format!(
                        "scale {:.0}% · hit {:.0}% · offset ({:.0}, {:.0})",
                        s.settings.playfield_scale * 100.0,
                        s.settings.hit_position * 100.0,
                        s.settings.offset_x,
                        s.settings.offset_y,
                    ),
                    col()
                        .gap(space::S2)
                        .child(
                            row()
                                .gap(space::S2)
                                .child(settings_btn(p, "Size −", |s| {
                                    s.settings.nudge_scale(-SCALE_STEP);
                                }))
                                .child(settings_btn(p, "Size +", |s| {
                                    s.settings.nudge_scale(SCALE_STEP);
                                }))
                                .child(settings_btn(p, "Hit −", |s| {
                                    s.settings.nudge_hit_position(-HIT_POS_STEP);
                                }))
                                .child(settings_btn(p, "Hit +", |s| {
                                    s.settings.nudge_hit_position(HIT_POS_STEP);
                                })),
                        )
                        .child(
                            row()
                                .gap(space::S2)
                                .child(settings_btn(p, "←", |s| {
                                    s.settings.nudge_offset(-OFFSET_STEP, 0.0);
                                }))
                                .child(settings_btn(p, "→", |s| {
                                    s.settings.nudge_offset(OFFSET_STEP, 0.0);
                                }))
                                .child(settings_btn(p, "↑", |s| {
                                    s.settings.nudge_offset(0.0, -OFFSET_STEP);
                                }))
                                .child(settings_btn(p, "↓", |s| {
                                    s.settings.nudge_offset(0.0, OFFSET_STEP);
                                }))
                                .child(settings_btn(p, "Reset layout", |s| {
                                    s.settings.reset_layout();
                                    s.settings_hint = "layout reset".into();
                                })),
                        ),
                ))
                .child(settings_section(
                    p,
                    "Scroll & skin",
                    format!(
                        "scroll {:.0} px/s · {}",
                        s.settings.scroll_speed, s.settings.skin_status
                    ),
                    row()
                        .gap(space::S2)
                        .child(settings_btn(p, "−spd", |s| {
                            s.settings.nudge_scroll(-SCROLL_STEP);
                        }))
                        .child(settings_btn(p, "+spd", |s| {
                            s.settings.nudge_scroll(SCROLL_STEP);
                        }))
                        .child(settings_btn(p, "skin on/off", |s| {
                            if s.settings.skin.is_none() {
                                s.settings_hint = s.settings.skin_status.clone();
                            } else {
                                s.settings.use_skin = !s.settings.use_skin;
                                s.settings_hint = s.settings.skin_mode_label();
                            }
                        })),
                ))
                .child(settings_section(
                    p,
                    "7K keybinds",
                    if let Some(lane) = rebinding {
                        format!("press a key for lane {}…", lane + 1)
                    } else {
                        keybinds::format_bindings_hint(keys)
                    },
                    {
                        let mut keys_row = row().gap(space::S2);
                        for lane in 0..7usize {
                            let label = if rebinding == Some(lane) {
                                format!("L{} …", lane + 1)
                            } else {
                                format!(
                                    "L{} {}",
                                    lane + 1,
                                    keybinds::format_key_label(&keys[lane])
                                )
                            };
                            keys_row = keys_row.child(settings_btn(p, label, move |s| {
                                s.rebinding_lane = Some(lane);
                                s.settings_hint =
                                    format!("waiting for key — lane {}", lane + 1);
                            }));
                        }
                        col()
                            .gap(space::S2)
                            .child(keys_row)
                            .child(settings_btn(p, "Reset keys", |s| {
                                s.settings.reset_keys();
                                s.rebinding_lane = None;
                                s.settings_hint = "keys reset to S D F Space J K L".into();
                            }))
                    },
                ))
                .child(settings_section(
                    p,
                    "Window",
                    if fullscreen {
                        "near-fullscreen (resized to primary display)".into()
                    } else {
                        "windowed".into()
                    },
                    row()
                        .gap(space::S2)
                        .child(settings_btn(
                            p,
                            if fullscreen { "Exit fullscreen" } else { "Fullscreen" },
                            |s| {
                                let on = s.shared.toggle_fullscreen();
                                s.settings_hint = if on {
                                    "fullscreen on (F11)".into()
                                } else {
                                    "windowed".into()
                                };
                            },
                        ))
                        .child(settings_btn(
                            p,
                            if s.settings.layout_edit {
                                "Layout edit: on"
                            } else {
                                "Layout edit: off"
                            },
                            |s| {
                                s.settings.layout_edit = !s.settings.layout_edit;
                                s.settings_hint = if s.settings.layout_edit {
                                    "in play: drag the stage (or F2)".into()
                                } else {
                                    "layout locked".into()
                                };
                            },
                        )),
                ))
                .child(
                    text(if s.settings_hint.is_empty() {
                        "Tip: F11 fullscreen · F2 edit layout in play · drag stage when editing"
                            .into()
                    } else {
                        s.settings_hint.clone()
                    })
                    .font(type_::LABEL)
                    .color(p.t.text_secondary),
                ),
        )
}

fn settings_section(p: Paint, title: &'static str, subtitle: String, controls: El) -> El {
    col()
        .gap(space::S2)
        .padding(space::S3)
        .radius(radius::LG)
        .fill(p.t.card)
        .border(p.hair, p.t.card_border)
        .child(text(title).font(type_::BODY).color(p.t.text))
        .child(text(subtitle).font(type_::LABEL).color(p.t.text_secondary))
        .child(controls)
}

fn start_selected(s: &mut State) {
    let Some(row) = s.catalog.get(s.selected).cloned() else {
        s.start_hint = "No beatmap selected.".into();
        return;
    };
    match load_chart_from_hash(&row.hash, row.overall_difficulty) {
        Ok(chart) => {
            let engine = GameplayEngine::load(&chart);
            let title = format!("{} — {}", row.artist, row.title);
            let music = row.audio_file_hash.as_ref().and_then(|hash| {
                let path = lazer_file_path(&osu_data_path(), hash);
                match Music::try_open(&path) {
                    Ok(m) => Some(m),
                    Err(err) => {
                        eprintln!("play-rune: audio skipped — {err}");
                        None
                    }
                }
            });
            s.start_hint.clear();
            s.playing.store(true, std::sync::atomic::Ordering::Relaxed);
            s.phase = Phase::Playing(PlaySession::new(title, chart, engine, music, &s.settings));
        }
        Err(err) => {
            s.start_hint = err.to_string();
        }
    }
}

fn overlay_page(s: &State, p: Paint) -> El {
    let snap = s.shared.snapshot();
    col()
        .key("overlay-settings")
        .grow(1.0)
        .min_h(0.0)
        .px(space::S6)
        .pt(space::S6)
        .pb(space::S6)
        .gap(space::S6)
        .child(page_header(
            p,
            "Overlay",
            "WindowOptions::overlay · click-through and visibility",
        ))
        .child(settings_card(
            p,
            "Presentation",
            [
                toggle_row(
                    p,
                    "visible",
                    "Show overlay",
                    s.overlay_visible,
                    |s| {
                        let next = !s.overlay_visible;
                        s.overlay_visible = next;
                        s.shared.apply(AppCommand::SetOverlayVisible(next));
                    },
                ),
                toggle_row(
                    p,
                    "click",
                    "Click-through",
                    s.click_through,
                    |s| {
                        let next = !s.click_through;
                        s.click_through = next;
                        s.shared.apply(AppCommand::SetClickThrough(next));
                    },
                ),
            ],
        ))
        .child(settings_card(
            p,
            "Telemetry",
            [status_row(p, &snap.status)],
        ))
}

fn settings_card<const N: usize>(p: Paint, title: &'static str, rows: [El; N]) -> El {
    let mut card = col()
        .key("card")
        .padding(space::S1)
        .fill(p.t.card)
        .radius(radius::LG)
        .border(p.hair, p.t.card_border);
    for (i, r) in rows.into_iter().enumerate() {
        card = card.child(r);
        if i + 1 < N {
            card = card.child(
                el().key(format!("sep{i}"))
                    .h(p.hair)
                    .ml(space::S3)
                    .mr(space::S3)
                    .fill(p.t.separator),
            );
        }
    }
    col()
        .gap(space::S2)
        .child(
            text(title)
                .font(type_::SECTION)
                .color(p.t.text_secondary)
                .ml(space::S3),
        )
        .child(card)
}

fn toggle_row(
    p: Paint,
    key: &'static str,
    label: &'static str,
    on: bool,
    flip: impl Fn(&mut State) + 'static,
) -> El {
    row()
        .key(key)
        .h(48.0)
        .px(space::S3)
        .center_y()
        .justify_between()
        .radius(radius::MD)
        .hover(p.t.hover)
        .press(p.t.press)
        .focusable(true)
        .on_press(flip)
        .child(text(label).font(type_::BODY).color(p.t.text))
        .child(toggle(p, on))
}

fn toggle(p: Paint, on: bool) -> El {
    let (w, h, k) = (38.0, 22.0, 18.0);
    let inset = (h - k) / 2.0;
    el().key("switch")
        .size(w, h)
        .radius(h / 2.0)
        .fill(if on { p.accent } else { p.t.control_off })
        .motion(motion::SNAPPY)
        .child(
            el().key("knob")
                .size(k, k)
                .absolute(if on { w - k - inset } else { inset }, inset)
                .radius(k / 2.0)
                .fill(p.t.knob),
        )
}

fn status_row(p: Paint, status: &str) -> El {
    row()
        .key("telemetry-status")
        .h(48.0)
        .px(space::S3)
        .center_y()
        .justify_between()
        .child(text("Live status").font(type_::BODY).color(p.t.text))
        .child(
            text(status.to_string())
                .font(type_::MONO_CAPTION)
                .color(p.accent),
        )
}

fn about_page(p: Paint) -> El {
    col()
        .key("about")
        .grow(1.0)
        .px(space::S6)
        .pt(space::S6)
        .gap(space::S3)
        .child(page_header(
            p,
            "About this spike",
            "Visual / navigation parity with bun play — not feature parity yet",
        ))
        .child(
            col()
                .gap(space::S2)
                .padding(space::S6)
                .radius(radius::LG)
                .fill(p.t.card)
                .border(p.hair, p.t.card_border)
                .child(
                    text("Still in apps/play (GPUIX)")
                        .font(type_::BODY)
                        .color(p.t.text),
                )
                .child(bullet(p, "Full GPUIX UI, audio (miniaudio), skins, results persistence"))
                .child(bullet(p, "Collections filter and rich song-select search"))
                .child(el().h(space::S3))
                .child(
                    text("Here (Rune)")
                        .font(type_::BODY)
                        .color(p.t.text),
                )
                .child(bullet(p, "Read-only local mirror mania 7K list"))
                .child(bullet(p, "Playfield + judgment + rodio audio when audio_file_hash exists"))
                .child(bullet(p, "Overlay click-through prototype")),
        )
}

fn bullet(p: Paint, line: &'static str) -> El {
    text(format!("· {line}"))
        .font(type_::BODY)
        .color(p.t.text_secondary)
}
