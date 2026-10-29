//! Dedicated Wayland connection for `zwlr_foreign_toplevel_manager_v1`.
//! Runs off the GTK thread and posts [`FocusCommand`] over an async-channel.

use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::sync::mpsc;
use tracing::{debug, info, warn};
use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry;
use wayland_client::{Connection, Dispatch, Proxy, QueueHandle};
use wayland_protocols_wlr::foreign_toplevel::v1::client::{
    zwlr_foreign_toplevel_handle_v1::{self, ZwlrForeignToplevelHandleV1},
    zwlr_foreign_toplevel_manager_v1::{self, ZwlrForeignToplevelManagerV1},
};

#[derive(Debug, Clone)]
pub enum FocusCommand {
    Show,
    Hide,
    Disconnected,
}

#[derive(Debug)]
pub enum FocusEvent {
    Dump(Vec<String>),
}

#[derive(Debug, Default)]
struct ToplevelState {
    app_id: String,
    title: String,
    activated: bool,
}

struct FocusState {
    match_app_id: String,
    toplevels: HashMap<u32, ToplevelState>,
    cmd_tx: Option<async_channel::Sender<FocusCommand>>,
    dump_tx: Option<mpsc::Sender<FocusEvent>>,
    last_visible: Option<bool>,
    list_only: bool,
}

impl FocusState {
    fn matches(&self, tl: &ToplevelState) -> bool {
        let needle = self.match_app_id.as_str();
        if !tl.app_id.is_empty() {
            return contains_ci(&tl.app_id, needle);
        }
        if !tl.title.is_empty() {
            return contains_ci(&tl.title, needle);
        }
        false
    }

    fn recompute(&mut self) {
        if self.list_only {
            return;
        }
        let Some(tx) = self.cmd_tx.as_ref() else {
            return;
        };
        let mut any = false;
        let mut focused = false;
        for tl in self.toplevels.values() {
            if !self.matches(tl) {
                continue;
            }
            any = true;
            if tl.activated {
                focused = true;
            }
        }
        if !any {
            debug!(match_app_id = %self.match_app_id, "waiting for matching window");
        }
        if self.last_visible == Some(focused) {
            return;
        }
        self.last_visible = Some(focused);
        let cmd = if focused {
            FocusCommand::Show
        } else {
            FocusCommand::Hide
        };
        if tx.send_blocking(cmd).is_err() {
            warn!("focus command channel closed");
        }
    }

    fn dump_lines(&self) -> Vec<String> {
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

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

pub fn run_list_windows(tx: mpsc::Sender<FocusEvent>, match_app_id: String) -> Result<()> {
    let mut state = FocusState {
        match_app_id,
        toplevels: HashMap::new(),
        cmd_tx: None,
        dump_tx: Some(tx),
        last_visible: None,
        list_only: true,
    };
    run_loop(&mut state)
}

pub fn run_focus_loop(
    match_app_id: String,
    cmd_tx: async_channel::Sender<FocusCommand>,
) -> Result<()> {
    let mut state = FocusState {
        match_app_id,
        toplevels: HashMap::new(),
        cmd_tx: Some(cmd_tx.clone()),
        dump_tx: None,
        last_visible: None,
        list_only: false,
    };
    let result = run_loop(&mut state);
    let _ = cmd_tx.send_blocking(FocusCommand::Disconnected);
    result
}

fn run_loop(state: &mut FocusState) -> Result<()> {
    let conn = Connection::connect_to_env().context("connect Wayland display")?;
    let (globals, mut queue) =
        registry_queue_init::<FocusState>(&conn).context("init Wayland registry")?;
    let qh = queue.handle();

    let _manager: ZwlrForeignToplevelManagerV1 = match globals.bind(&qh, 1..=3, ()) {
        Ok(m) => m,
        Err(_) => bail!("compositor lacks zwlr_foreign_toplevel_manager_v1"),
    };

    for _ in 0..8 {
        queue.roundtrip(state).context("wayland roundtrip")?;
        if state.list_only && !state.toplevels.is_empty() {
            break;
        }
        if !state.list_only {
            break;
        }
    }

    if state.list_only {
        if let Some(tx) = state.dump_tx.take() {
            let _ = tx.send(FocusEvent::Dump(state.dump_lines()));
        }
        return Ok(());
    }

    for _ in 0..4 {
        queue.roundtrip(state).context("wayland roundtrip")?;
    }
    state.recompute();

    info!("foreign-toplevel focus loop running on dedicated connection");
    loop {
        queue.blocking_dispatch(state).context("wayland dispatch")?;
    }
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for FocusState {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ZwlrForeignToplevelManagerV1, ()> for FocusState {
    fn event(
        state: &mut Self,
        _: &ZwlrForeignToplevelManagerV1,
        event: zwlr_foreign_toplevel_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        use zwlr_foreign_toplevel_manager_v1::Event;
        match event {
            Event::Toplevel { toplevel } => {
                let id = toplevel.id().protocol_id();
                state.toplevels.insert(id, ToplevelState::default());
            }
            Event::Finished => {
                warn!("foreign-toplevel manager finished");
            }
            _ => {}
        }
    }

    wayland_client::event_created_child!(FocusState, ZwlrForeignToplevelManagerV1, [
        // EVT_TOPLEVEL opcode 0
        zwlr_foreign_toplevel_manager_v1::EVT_TOPLEVEL_OPCODE
            => (ZwlrForeignToplevelHandleV1, ())
    ]);
}

impl Dispatch<ZwlrForeignToplevelHandleV1, ()> for FocusState {
    fn event(
        state: &mut Self,
        handle: &ZwlrForeignToplevelHandleV1,
        event: zwlr_foreign_toplevel_handle_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        use zwlr_foreign_toplevel_handle_v1::Event;
        let id = handle.id().protocol_id();
        match event {
            Event::Title { title } => {
                if let Some(tl) = state.toplevels.get_mut(&id) {
                    tl.title = title;
                }
            }
            Event::AppId { app_id } => {
                if let Some(tl) = state.toplevels.get_mut(&id) {
                    tl.app_id = app_id;
                }
            }
            Event::State { state: states } => {
                let activated = states.chunks_exact(4).any(|chunk| {
                    let v = u32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    v == (zwlr_foreign_toplevel_handle_v1::State::Activated as u32)
                });
                if let Some(tl) = state.toplevels.get_mut(&id) {
                    tl.activated = activated;
                }
            }
            Event::Done => {
                state.recompute();
            }
            Event::Closed => {
                state.toplevels.remove(&id);
                state.recompute();
            }
            _ => {}
        }
    }
}
