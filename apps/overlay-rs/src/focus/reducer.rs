//! Pure focus reducer: toplevel events in → Show/Hide out.
//!
//! Call [`FocusReducer::end_batch`] once after each Wayland dispatch so
//! alt-tab does not emit a transient Hide when no matching window is
//! activated mid-batch.

use std::collections::HashMap;

use super::matching::MatchPolicy;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ToplevelId(pub u32);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToplevelInfo {
    pub app_id: String,
    pub title: String,
    pub activated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToplevelEvent {
    Added(ToplevelId),
    Title { id: ToplevelId, title: String },
    AppId { id: ToplevelId, app_id: String },
    State { id: ToplevelId, activated: bool },
    Closed(ToplevelId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisibilityCommand {
    Show,
    Hide,
}

#[derive(Debug)]
pub struct FocusReducer {
    policy: MatchPolicy,
    toplevels: HashMap<ToplevelId, ToplevelInfo>,
    last_visible: Option<bool>,
    dirty: bool,
    waiting_logged: bool,
}

impl FocusReducer {
    pub fn new(policy: MatchPolicy) -> Self {
        Self {
            policy,
            toplevels: HashMap::new(),
            last_visible: None,
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
            ToplevelEvent::State { id, activated } => {
                if let Some(tl) = self.toplevels.get_mut(&id) {
                    if tl.activated != activated {
                        tl.activated = activated;
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
        for tl in self.toplevels.values() {
            if !self.policy.matches(&tl.app_id, &tl.title) {
                continue;
            }
            any_match = true;
            if tl.activated {
                match_focused = true;
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
            return None;
        }
        self.last_visible = Some(match_focused);
        Some(if match_focused {
            VisibilityCommand::Show
        } else {
            VisibilityCommand::Hide
        })
    }

    pub fn dump_lines(&self) -> Vec<String> {
        self.toplevels
            .values()
            .map(|tl| {
                format!(
                    "{} app_id='{}' title='{}'",
                    if tl.activated { "*" } else { " " },
                    tl.app_id,
                    tl.title
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

    #[test]
    fn show_only_when_matched_and_activated() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: false,
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: true,
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Show));
        assert_eq!(r.end_batch(), None);
    }

    #[test]
    fn alt_tab_batch_skips_transient_hide() {
        let mut r = reducer();
        // osu focused
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: true,
        });
        // other window
        r.apply(ToplevelEvent::Added(ToplevelId(2)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(2),
            app_id: "firefox".into(),
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Show));

        // Mid alt-tab: osu deactivates then firefox activates — if evaluated
        // per-event we'd Hide then stay Hidden; batched we only care about
        // the end state. Here both still present: osu deactivated, firefox
        // activated → Hide once.
        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: false,
        });
        // Without end_batch yet — no command emitted.
        r.apply(ToplevelEvent::State {
            id: ToplevelId(2),
            activated: true,
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        // Alt-tab back: firefox off, osu on — single Show at batch end.
        r.apply(ToplevelEvent::State {
            id: ToplevelId(2),
            activated: false,
        });
        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: true,
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Show));
    }

    #[test]
    fn closed_matching_window_hides() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::AppId {
            id: ToplevelId(1),
            app_id: "osu!".into(),
        });
        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: true,
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Show));

        r.apply(ToplevelEvent::Closed(ToplevelId(1)));
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));
    }

    #[test]
    fn title_change_can_start_matching() {
        let mut r = reducer();
        r.apply(ToplevelEvent::Added(ToplevelId(1)));
        r.apply(ToplevelEvent::State {
            id: ToplevelId(1),
            activated: true,
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Hide));

        r.apply(ToplevelEvent::Title {
            id: ToplevelId(1),
            title: "osu!lazer".into(),
        });
        assert_eq!(r.end_batch(), Some(VisibilityCommand::Show));
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
