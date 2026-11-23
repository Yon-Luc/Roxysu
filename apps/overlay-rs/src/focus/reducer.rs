//! Pure focus reducer: toplevel events in → Show/Hide out.
//!
//! Call [`FocusReducer::end_batch`] once after each Wayland dispatch so
//! alt-tab does not emit a transient Hide when no matching window is
//! activated mid-batch.

use std::collections::HashMap;

use super::matching::MatchPolicy;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ToplevelId(pub u32);

/// Window centre is not enough for a monitor that only overlaps a corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Pin hint. A name is a `wl_output` connector (or model). A rect is Plasma
/// global geometry, resolved to a `GdkMonitor` on the GTK thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputHint {
    Name(String),
    Rect(OutputRect),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToplevelInfo {
    pub app_id: String,
    pub title: String,
    /// XWayland resource name. Dumped by `--list-windows`. Not a match haystack.
    pub resource_name: String,
    pub activated: bool,
    pub minimized: bool,
    /// Most recently entered output name last.
    pub output_names: Vec<String>,
    pub bounds: Option<OutputRect>,
}

impl ToplevelInfo {
    fn output_hint(&self) -> Option<OutputHint> {
        if let Some(name) = self.output_names.last() {
            return Some(OutputHint::Name(name.clone()));
        }
        self.bounds.map(OutputHint::Rect)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToplevelEvent {
    Added(ToplevelId),
    Title {
        id: ToplevelId,
        title: String,
    },
    AppId {
        id: ToplevelId,
        app_id: String,
    },
    /// Stored for `--list-windows`. Does not change visibility.
    ResourceName {
        id: ToplevelId,
        resource_name: String,
    },
    State {
        id: ToplevelId,
        activated: bool,
        minimized: bool,
    },
    OutputEnter {
        id: ToplevelId,
        name: String,
    },
    OutputLeave {
        id: ToplevelId,
        name: String,
    },
    /// The output with this name is gone (hot-unplug). Applies leave
    /// semantics to every toplevel that had entered it (N4).
    OutputGone(String),
    Bounds {
        id: ToplevelId,
        rect: OutputRect,
    },
    Closed(ToplevelId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VisibilityCommand {
    Show { output: Option<OutputHint> },
    Hide,
}

#[derive(Debug)]
pub struct FocusReducer {
    policy: MatchPolicy,
    toplevels: HashMap<ToplevelId, ToplevelInfo>,
    last_visible: Option<bool>,
    last_hint: Option<OutputHint>,
    dirty: bool,
    waiting_logged: bool,
}

impl FocusReducer {
    pub fn new(policy: MatchPolicy) -> Self {
        Self {
            policy,
            toplevels: HashMap::new(),
            last_visible: None,
            last_hint: None,
            dirty: false,
            waiting_logged: false,
        }
    }

    pub fn policy(&self) -> &MatchPolicy {
        &self.policy
    }

    pub fn toplevels(&self) -> &HashMap<ToplevelId, ToplevelInfo> {
        &self.toplevels
    }

    /// True when events since the last `end_batch` would change evaluation.
    /// `--list-windows` uses a quiet batch as its wlr settle condition.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn apply(&mut self, event: ToplevelEvent) {
        match event {
            ToplevelEvent::Added(id) => {
                self.toplevels.insert(id, ToplevelInfo::default());
                self.dirty = true;
            }
            ToplevelEvent::Title { id, title } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    if tl.title != title {
                        tl.title = title;
                        self.dirty = true;
                    }
                }
            }
            ToplevelEvent::AppId { id, app_id } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    if tl.app_id != app_id {
                        tl.app_id = app_id;
                        self.dirty = true;
                    }
                }
            }
            ToplevelEvent::ResourceName { id, resource_name } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    tl.resource_name = resource_name;
                }
            }
            ToplevelEvent::State {
                id,
                activated,
                minimized,
            } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    if tl.activated != activated || tl.minimized != minimized {
                        tl.activated = activated;
                        tl.minimized = minimized;
                        self.dirty = true;
                    }
                }
            }
            ToplevelEvent::OutputEnter { id, name } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    if tl.output_names.last() == Some(&name) {
                        return;
                    }
                    tl.output_names.retain(|existing| existing != &name);
                    tl.output_names.push(name);
                    self.dirty = true;
                }
            }
            ToplevelEvent::OutputLeave { id, name } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    let before = tl.output_names.len();
                    tl.output_names.retain(|existing| existing != &name);
                    if tl.output_names.len() != before {
                        self.dirty = true;
                    }
                }
            }
            ToplevelEvent::OutputGone(name) => {
                let mut changed = false;
                for tl in self.toplevels.values_mut() {
                    let before = tl.output_names.len();
                    tl.output_names.retain(|existing| existing != &name);
                    if tl.output_names.len() != before {
                        changed = true;
                    }
                }
                if changed {
                    self.dirty = true;
                }
            }
            ToplevelEvent::Bounds { id, rect } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    if tl.bounds != Some(rect) {
                        tl.bounds = Some(rect);
                        self.dirty = true;
                    }
                }
            }
            ToplevelEvent::Closed(id) => {
                if self.toplevels.remove(&id).is_some() {
                    self.dirty = true;
                }
            }
        }
    }

    /// Evaluate visibility once after a dispatch batch.
    pub fn end_batch(&mut self) -> Option<VisibilityCommand> {
        if !self.dirty {
            return None;
        }
        self.dirty = false;

        let mut any_match = false;
        let mut match_focused = false;
        let mut focused_hint = None;
        for tl in self.toplevels.values() {
            if !self.policy.matches(&tl.app_id, &tl.title) {
                continue;
            }
            any_match = true;
            if tl.activated && !tl.minimized {
                match_focused = true;
                if focused_hint.is_none() {
                    focused_hint = tl.output_hint();
                }
            }
        }

        if !any_match {
            if !self.waiting_logged {
                self.waiting_logged = true;
                tracing::info!(
                    match_app_id = %self.policy.needle(),
                    "waiting for a focused window matching --match-app-id"
                );
            }
        } else {
            self.waiting_logged = false;
        }

        if self.last_visible == Some(match_focused) {
            if match_focused && focused_hint != self.last_hint {
                self.last_hint = focused_hint.clone();
                return Some(VisibilityCommand::Show {
                    output: focused_hint,
                });
            }
            return None;
        }
        self.last_visible = Some(match_focused);
        self.last_hint = if match_focused {
            focused_hint.clone()
        } else {
            None
        };
        Some(if match_focused {
            VisibilityCommand::Show {
                output: focused_hint,
            }
        } else {
            VisibilityCommand::Hide
        })
    }

    pub fn dump_lines(&self) -> Vec<String> {
        self.toplevels
            .values()
            .map(|tl| {
                format!(
                    "{} app_id='{}' title='{}' resource_name='{}' minimized={}",
                    if tl.activated { "*" } else { " " },
                    tl.app_id,
                    tl.title,
                    tl.resource_name,
                    tl.minimized as u8
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::matching::{MatchMode, MatchPolicy};

    fn reducer() -> FocusReducer {
        FocusReducer::new(MatchPolicy::new("osu", MatchMode::Contains))
    }

    fn state(id: u32, activated: bool, minimized: bool) -> ToplevelEvent {
        ToplevelEvent::State {
            id: ToplevelId(id),
            activated,
            minimized,
        }
    }

    #[test]
    fn show_only_when_matched_and_activated() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, false, false));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        r.apply(state(1, true, false));
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );
        assert_eq!(r.end_batch(), None);
    }

    #[test]
    fn minimized_matched_window_stays_hidden() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, true));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        r.apply(state(1, true, false));
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );
    }

    #[test]
    fn output_move_while_shown_emits_new_show() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        r.apply(ToplevelEvent::OutputEnter {
            id: ToplevelId(1),
            name: "DP-4".into(),
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Name("DP-4".into()))
            })
        );

        r.apply(ToplevelEvent::OutputLeave {
            id: ToplevelId(1),
            name: "DP-4".into(),
        });
        r.apply(ToplevelEvent::OutputEnter {
            id: ToplevelId(1),
            name: "DP-5".into(),
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Name("DP-5".into()))
            })
        );
        assert_eq!(r.end_batch(), None);
    }

    #[test]
    fn bounds_change_while_shown_emits_new_show() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        let first = OutputRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        r.apply(ToplevelEvent::Bounds {
            id: ToplevelId(1),
            rect: first,
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Rect(first))
            })
        );
        let second = OutputRect {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        r.apply(ToplevelEvent::Bounds {
            id: ToplevelId(1),
            rect: second,
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Rect(second))
            })
        );
    }

    #[test]
    fn resource_name_is_dumped_and_does_not_match() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "dotnet".into(),
        });
        r.apply(ToplevelEvent::Title {
            id: ToplevelId(1),
            title: "Firefox".into(),
        });
        r.apply(ToplevelEvent::ResourceName {
            id: ToplevelId(1),
            resource_name: "osu!".into(),
        });
        r.apply(state(1, true, false));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));
        let lines = r.dump_lines();
        assert!(lines
            .iter()
            .any(|line| line.contains("resource_name='osu!'")));
        assert!(lines.iter().any(|line| line.contains("app_id='dotnet'")));
    }

    #[test]
    fn alt_tab_batch_skips_transient_hide() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        r.apply(ToplevelEvent::Added(ToplevelId(2)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(2),
            app_id: "firefox".into(),
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );

        r.apply(state(1, false, false));
        r.apply(state(2, true, false));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        r.apply(state(2, false, false));
        r.apply(state(1, true, false));
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );
    }

    #[test]
    fn output_gone_removes_the_name_from_every_toplevel() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        r.apply(ToplevelEvent::OutputEnter {
            id: ToplevelId(1),
            name: "DP-1".into(),
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Name("DP-1".into()))
            })
        );

        // Hot-unplug (N4): the name leaves all toplevels; visibility is
        // unchanged so the batch only re-evaluates the hint to None.
        r.apply(ToplevelEvent::OutputGone("DP-1".into()));
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );
        assert!(r
            .toplevels()
            .get(&ToplevelId(1))
            .unwrap()
            .output_names
            .is_empty());
    }

    #[test]
    fn output_gone_keeps_other_names() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        // Last-entered wins the hint, so enter DP-2 before DP-1.
        r.apply(ToplevelEvent::OutputEnter {
            id: ToplevelId(1),
            name: "DP-2".into(),
        });
        r.apply(ToplevelEvent::OutputEnter {
            id: ToplevelId(1),
            name: "DP-1".into(),
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Name("DP-1".into()))
            })
        );

        // Hot-unplug of the hinted output falls back to the remaining name.
        r.apply(ToplevelEvent::OutputGone("DP-1".into()));
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show {
                output: Some(OutputHint::Name("DP-2".into()))
            })
        );
    }

    #[test]
    fn output_gone_for_an_unknown_name_changes_nothing() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        r.apply(ToplevelEvent::OutputEnter {
            id: ToplevelId(1),
            name: "DP-1".into(),
        });
        r.end_batch();
        r.apply(ToplevelEvent::OutputGone("DP-9".into()));
        assert_eq!(r.end_batch(), None);
    }

    #[test]
    fn closed_matching_window_hides() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(state(1, true, false));
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );

        r.apply(ToplevelEvent::Closed(ToplevelId(1)));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));
    }

    #[test]
    fn title_change_can_start_matching() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(state(1, true, false));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        r.apply(ToplevelEvent::Title {
            id: ToplevelId(1),
            title: "osu!lazer".into(),
        });
        assert_eq!(
            r.end_batch(),
            Some(VisibilityCommand::Show { output: None })
        );
    }

    #[test]
    fn no_spurious_command_when_unchanged() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "firefox".into(),
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));
        r.apply(ToplevelEvent::Title {
            id: ToplevelId(1),
            title: "Docs".into(),
        });
        assert_eq!(r.end_batch(), None);
    }
}
