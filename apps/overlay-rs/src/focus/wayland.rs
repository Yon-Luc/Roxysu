//! Dedicated Wayland connection for `zwlr_foreign_toplevel_manager_v1`.
//! Dispatches off the GTK thread; emits commands only after each batch.

use anyhow::{bail, Context, Result};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};
use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry;
use wayland_client::{Connection, Dispatch, Proxy, QueueHandle};
use wayland_protocols_wlr::foreign_toplevel::v1::client::{
    zwlr_foreign_toplevel_handle_v1::{self, ZwlrForeignToplevelHandleV1},
    zwlr_foreign_toplevel_manager_v1::{self, ZwlrForeignToplevelManagerV1},
};

use super::matching::MatchPolicy;
use super::reducer::{FocusReducer, ToplevelEvent, ToplevelId, VisibilityCommand};
use super::FocusCommand;

#[derive(Debug)]
pub enum FocusEvent {
    Dump(Vec<String>),
}

struct Session {
    reducer: FocusReducer,
    cmd_tx: Option<async_channel::Sender<FocusCommand>>,
    dump_tx: Option<mpsc::Sender<FocusEvent>>,
    list_only: bool,
    finished: bool,
}

impl Session {
    fn emit_visibility(&self, cmd: VisibilityCommand) {
        let Some(tx) = self.cmd_tx.as_ref() else {
            return;
        };
        let out = match cmd {
            VisibilityCommand::Show => FocusCommand::Show,
            VisibilityCommand::Hide => FocusCommand::Hide,
        };
        if tx.send_blocking(out).is_err() {
            warn!("focus command channel closed");
        }
    }

    fn flush_batch(&mut self) {
        if let Some(cmd) = self.reducer.end_batch() {
            self.emit_visibility(cmd);
        }
    }
}

pub fn run_list_windows(tx: mpsc::Sender<FocusEvent>, policy: MatchPolicy) -> Result<()> {
    let mut session = Session {
        reducer: FocusReducer::new(policy),
        cmd_tx: None,
        dump_tx: Some(tx),
        list_only: true,
        finished: false,
    };
    run_once(&mut session)
}

/// Focus loop with reconnect. First-connect failure → [`FocusCommand::Unavailable`].
/// Later drops → [`FocusCommand::Disconnected`] (visibility unchanged) then retry.
pub fn run_focus_loop(
    policy: MatchPolicy,
    cmd_tx: async_channel::Sender<FocusCommand>,
) -> Result<()> {
    let mut first = true;
    let mut backoff = Duration::from_secs(1);

    loop {
        let mut session = Session {
            reducer: FocusReducer::new(policy.clone()),
            cmd_tx: Some(cmd_tx.clone()),
            dump_tx: None,
            list_only: false,
            finished: false,
        };

        match run_once(&mut session) {
            Ok(()) => {
                // Manager finished or clean exit — try to reconnect.
                first = false;
                warn!("foreign-toplevel session ended; reconnecting");
                let _ = cmd_tx.send_blocking(FocusCommand::Disconnected);
            }
            Err(err) if first => {
                let _ = cmd_tx.send_blocking(FocusCommand::Unavailable);
                return Err(err);
            }
            Err(err) => {
                warn!(error = %err, "foreign-toplevel session failed; reconnecting");
                let _ = cmd_tx.send_blocking(FocusCommand::Disconnected);
            }
        }

        thread::sleep(backoff);
        backoff = (backoff.saturating_mul(2)).min(Duration::from_secs(30));
    }
}

fn run_once(session: &mut Session) -> Result<()> {
    let conn = Connection::connect_to_env().context("connect Wayland display")?;
    let (globals, mut queue) =
        registry_queue_init::<Session>(&conn).context("init Wayland registry")?;
    let qh = queue.handle();

    let _manager: ZwlrForeignToplevelManagerV1 = match globals.bind(&qh, 1..=3, ()) {
        Ok(m) => m,
        Err(_) => bail!("compositor lacks zwlr_foreign_toplevel_manager_v1"),
    };

    for _ in 0..8 {
        queue.roundtrip(session).context("wayland roundtrip")?;
        session.flush_batch();
        if session.list_only && !session.reducer.toplevels().is_empty() {
            break;
        }
        if !session.list_only {
            break;
        }
    }

    if session.list_only {
        if let Some(tx) = session.dump_tx.take() {
            let _ = tx.send(FocusEvent::Dump(session.reducer.dump_lines()));
        }
        return Ok(());
    }

    for _ in 0..4 {
        queue.roundtrip(session).context("wayland roundtrip")?;
        session.flush_batch();
    }

    info!(
        match_app_id = %session.reducer.policy().needle(),
        match_mode = %session.reducer.policy().mode(),
        "foreign-toplevel focus loop running on dedicated connection"
    );

    loop {
        if session.finished {
            return Ok(());
        }
        queue.blocking_dispatch(session).context("wayland dispatch")?;
        session.flush_batch();
    }
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for Session {
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

impl Dispatch<ZwlrForeignToplevelManagerV1, ()> for Session {
    fn event(
        session: &mut Self,
        _: &ZwlrForeignToplevelManagerV1,
        event: zwlr_foreign_toplevel_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        use zwlr_foreign_toplevel_manager_v1::Event;
        match event {
            Event::Toplevel { toplevel } => {
                let id = ToplevelId(toplevel.id().protocol_id());
                session.reducer.apply(ToplevelEvent::Added(id));
            }
            Event::Finished => {
                warn!("foreign-toplevel manager finished");
                session.finished = true;
            }
            _ => {}
        }
    }

    wayland_client::event_created_child!(Session, ZwlrForeignToplevelManagerV1, [
        zwlr_foreign_toplevel_manager_v1::EVT_TOPLEVEL_OPCODE
            => (ZwlrForeignToplevelHandleV1, ())
    ]);
}

impl Dispatch<ZwlrForeignToplevelHandleV1, ()> for Session {
    fn event(
        session: &mut Self,
        handle: &ZwlrForeignToplevelHandleV1,
        event: zwlr_foreign_toplevel_handle_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        use zwlr_foreign_toplevel_handle_v1::Event;
        let id = ToplevelId(handle.id().protocol_id());
        match event {
            Event::Title { title } => {
                session
                    .reducer
                    .apply(ToplevelEvent::Title { id, title });
            }
            Event::AppId { app_id } => {
                session
                    .reducer
                    .apply(ToplevelEvent::AppId { id, app_id });
            }
            Event::State { state: states } => {
                let activated = states.chunks_exact(4).any(|chunk| {
                    let v = u32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    v == (zwlr_foreign_toplevel_handle_v1::State::Activated as u32)
                });
                session
                    .reducer
                    .apply(ToplevelEvent::State { id, activated });
            }
            Event::Done => {
                // Batched: visibility evaluated after dispatch returns.
            }
            Event::Closed => {
                session.reducer.apply(ToplevelEvent::Closed(id));
            }
            _ => {}
        }
    }
}
