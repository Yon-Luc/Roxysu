//! Dedicated Wayland connection for focus tracking.
//!
//! Tries `zwlr_foreign_toplevel_manager_v1` first (niri, sway, Hyprland).
//! If that global is missing, [`super::plasma`] handles KWin. Dispatches off
//! the GTK thread and emits commands only after each batch.

use std::collections::{HashMap, HashSet};
use std::os::fd::AsRawFd;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tracing::{info, warn};
use wayland_client::globals::{registry_queue_init, GlobalList, GlobalListContents};
use wayland_client::protocol::wl_output::{self, WlOutput};
use wayland_client::protocol::wl_registry;
use wayland_client::{Connection, Dispatch, EventQueue, Proxy, QueueHandle};
use wayland_protocols_plasma::plasma_window_management::client::org_kde_plasma_window::OrgKdePlasmaWindow;
use wayland_protocols_plasma::plasma_window_management::client::org_kde_plasma_window_management::OrgKdePlasmaWindowManagement;
use wayland_protocols_wlr::foreign_toplevel::v1::client::{
    zwlr_foreign_toplevel_handle_v1::{self, ZwlrForeignToplevelHandleV1},
    zwlr_foreign_toplevel_manager_v1::{self, ZwlrForeignToplevelManagerV1},
};

use super::matching::MatchPolicy;
use super::reducer::{FocusReducer, ToplevelEvent, ToplevelId, VisibilityCommand};
use super::FocusCommand;

const PUMP_TIMEOUT_MS: i32 = 500;

const WLR_BACKEND: &str = "zwlr_foreign_toplevel_manager_v1";
const PLASMA_BACKEND: &str = "org_kde_plasma_window_management";

#[derive(Debug)]
pub enum FocusEvent {
    Dump(Vec<String>),
}

pub struct FocusHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl FocusHandle {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
        info!("focus tracking stopped");
    }
}

impl Drop for FocusHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

pub(super) struct Session {
    pub(super) reducer: FocusReducer,
    cmd_tx: Option<async_channel::Sender<FocusCommand>>,
    dump_tx: Option<mpsc::Sender<FocusEvent>>,
    list_only: bool,
    finished: bool,
    /// Set once the steady-state loop is reached, so a later drop is a
    /// disconnect rather than "no backend".
    entered: bool,
    stop: Option<Arc<AtomicBool>>,
    output_names: HashMap<u32, String>,
    /// Bound output proxies. Names are copied into `output_names`.
    #[allow(dead_code)]
    outputs: Vec<WlOutput>,
    pending_outputs: Vec<(ToplevelId, u32)>,
    /// Kept alive so the bound globals are not destroyed with the last proxy.
    #[allow(dead_code)]
    wlr_manager: Option<ZwlrForeignToplevelManagerV1>,
    #[allow(dead_code)]
    pub(super) plasma_manager: Option<OrgKdePlasmaWindowManagement>,
    pub(super) plasma_windows: HashMap<u32, OrgKdePlasmaWindow>,
    pub(super) seen_plasma: HashSet<u32>,
    /// Plasma window proxies adopted whose `InitialState` (the protocol's
    /// "static properties have been sent" marker) has not arrived yet.
    /// `--list-windows` waits on it so the dump cannot print
    /// half-described windows (N3).
    pub(super) plasma_pending_initial: HashSet<u32>,
    backend: &'static str,
}

impl Session {
    fn live(
        policy: MatchPolicy,
        cmd_tx: async_channel::Sender<FocusCommand>,
        stop: Arc<AtomicBool>,
    ) -> Self {
        Self {
            reducer: FocusReducer::new(policy),
            cmd_tx: Some(cmd_tx),
            dump_tx: None,
            list_only: false,
            finished: false,
            entered: false,
            stop: Some(stop),
            output_names: HashMap::new(),
            outputs: Vec::new(),
            pending_outputs: Vec::new(),
            wlr_manager: None,
            plasma_manager: None,
            plasma_windows: HashMap::new(),
            seen_plasma: HashSet::new(),
            plasma_pending_initial: HashSet::new(),
            backend: "none",
        }
    }

    fn list(policy: MatchPolicy, dump_tx: mpsc::Sender<FocusEvent>) -> Self {
        Self {
            reducer: FocusReducer::new(policy),
            cmd_tx: None,
            dump_tx: Some(dump_tx),
            list_only: true,
            finished: false,
            entered: false,
            stop: None,
            output_names: HashMap::new(),
            outputs: Vec::new(),
            pending_outputs: Vec::new(),
            wlr_manager: None,
            plasma_manager: None,
            plasma_windows: HashMap::new(),
            seen_plasma: HashSet::new(),
            plasma_pending_initial: HashSet::new(),
            backend: "none",
        }
    }

    pub(super) fn emit_visibility(&self, cmd: VisibilityCommand) {
        let Some(tx) = self.cmd_tx.as_ref() else {
            return;
        };
        let out = match cmd {
            VisibilityCommand::Show { output } => FocusCommand::Show { output },
            VisibilityCommand::Hide => FocusCommand::Hide,
        };
        if tx.send_blocking(out).is_err() {
            warn!("focus command channel closed");
        }
    }

    pub(super) fn flush_batch(&mut self) {
        if let Some(cmd) = self.reducer.end_batch() {
            self.emit_visibility(cmd);
        }
    }

    fn stopped(&self) -> bool {
        self.stop
            .as_ref()
            .is_some_and(|stop| stop.load(Ordering::Relaxed))
    }

    fn note_output_name(&mut self, output_id: u32, name: String) {
        self.output_names.insert(output_id, name.clone());
        let pending = std::mem::take(&mut self.pending_outputs);
        for (id, oid) in pending {
            if oid == output_id {
                self.reducer.apply(ToplevelEvent::OutputEnter {
                    id,
                    name: name.clone(),
                });
            } else {
                self.pending_outputs.push((id, oid));
            }
        }
    }

    fn output_entered(&mut self, toplevel: ToplevelId, output_id: u32) {
        if let Some(name) = self.output_names.get(&output_id).cloned() {
            self.reducer
                .apply(ToplevelEvent::OutputEnter { id: toplevel, name });
        } else {
            self.pending_outputs.push((toplevel, output_id));
        }
    }

    fn output_left(&mut self, toplevel: ToplevelId, output_id: u32) {
        self.pending_outputs
            .retain(|(id, oid)| !(*id == toplevel && *oid == output_id));
        if let Some(name) = self.output_names.get(&output_id).cloned() {
            self.reducer
                .apply(ToplevelEvent::OutputLeave { id: toplevel, name });
        }
    }

    /// `--list-windows` completeness (N3). Breaking on the first `Added`
    /// toplevel dumps half-described windows on Plasma — `Window` /
    /// `get_window` fill the toplevel map in the first roundtrip while
    /// `AppIdChanged` / `TitleChanged` / `ResourceNameChanged` /
    /// `InitialState` land in later ones. Plasma settles once every adopted
    /// window has sent `InitialState`; wlr settles on a quiet batch.
    pub(super) fn list_settled(&self, batch_was_quiet: bool) -> bool {
        if self.reducer.toplevels().is_empty() {
            return false;
        }
        if self.backend == PLASMA_BACKEND {
            return self.plasma_pending_initial.is_empty();
        }
        batch_was_quiet
    }
}

pub fn spawn_focus_loop(
    policy: MatchPolicy,
    cmd_tx: async_channel::Sender<FocusCommand>,
) -> Result<FocusHandle> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let join = thread::Builder::new()
        .name("overlay-focus".into())
        .spawn(move || {
            if let Err(err) = run_focus_loop(policy, cmd_tx, stop_thread) {
                eprintln!("roxysu-overlay-rs: focus thread exited: {err:#}");
            }
        })
        .context("spawn focus thread")?;
    Ok(FocusHandle {
        stop,
        join: Some(join),
    })
}

pub fn run_list_windows(tx: mpsc::Sender<FocusEvent>, policy: MatchPolicy) -> Result<()> {
    let mut session = Session::list(policy, tx);
    run_once(&mut session)
}

/// Reconnect forever. The first failure to find a backend emits
/// [`FocusCommand::Unavailable`] and retries. A drop after a live session
/// emits [`FocusCommand::Disconnected`].
fn run_focus_loop(
    policy: MatchPolicy,
    cmd_tx: async_channel::Sender<FocusCommand>,
    stop: Arc<AtomicBool>,
) -> Result<()> {
    let mut had_session = false;
    let mut announced = false;
    let mut backoff = Duration::from_secs(1);

    while !stop.load(Ordering::Relaxed) {
        let mut session = Session::live(policy.clone(), cmd_tx.clone(), Arc::clone(&stop));
        let result = run_once(&mut session);
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        let entered = session.entered;
        let wait = match result {
            Ok(()) => {
                had_session = true;
                announced = false;
                backoff = Duration::from_secs(1);
                warn!("focus session ended; reconnecting");
                let _ = cmd_tx.send_blocking(FocusCommand::Disconnected);
                backoff
            }
            Err(err) if entered || had_session => {
                had_session = true;
                announced = false;
                backoff = Duration::from_secs(1);
                warn!(error = %err, "focus session failed; reconnecting");
                let _ = cmd_tx.send_blocking(FocusCommand::Disconnected);
                backoff
            }
            Err(err) => {
                if !announced {
                    let reason = format!("{err:#}");
                    let _ = cmd_tx.send_blocking(FocusCommand::Unavailable { reason });
                    announced = true;
                } else {
                    warn!(error = %err, "focus session still unavailable; retrying");
                }
                let wait = backoff;
                backoff = backoff.saturating_mul(2).min(Duration::from_secs(30));
                wait
            }
        };
        sleep_backoff(wait, &stop);
    }
    Ok(())
}

fn sleep_backoff(total: Duration, stop: &AtomicBool) {
    let step = Duration::from_millis(100);
    let mut left = total;
    while left > Duration::ZERO {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let slice = if left < step { left } else { step };
        thread::sleep(slice);
        left = left.saturating_sub(slice);
    }
}

fn run_once(session: &mut Session) -> Result<()> {
    let conn = Connection::connect_to_env().context("connect Wayland display")?;
    let (globals, mut queue) =
        registry_queue_init::<Session>(&conn).context("init Wayland registry")?;
    let qh = queue.handle();

    bind_outputs(&globals, &qh, session);
    queue
        .roundtrip(session)
        .context("wayland roundtrip for output names")?;

    bind_backend(&globals, &qh, session)?;

    if session.list_only {
        // Settle instead of breaking on the first toplevel (N3). Cap bounds
        // the wait on a slow or busy compositor; the recv timeout in
        // overlay.rs bounds the whole dump.
        for _ in 0..16 {
            queue.roundtrip(session).context("wayland roundtrip")?;
            let batch_was_quiet = !session.reducer.is_dirty();
            session.flush_batch();
            if session.list_settled(batch_was_quiet) {
                break;
            }
        }
        if session.reducer.toplevels().is_empty() {
            warn!("no toplevels advertised before the roundtrip cap; dumping what is known");
        } else if !session.plasma_pending_initial.is_empty() {
            warn!(
                pending = session.plasma_pending_initial.len(),
                "dump may be incomplete: Plasma windows without InitialState"
            );
        }
    } else {
        queue.roundtrip(session).context("wayland roundtrip")?;
        session.flush_batch();
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
        backend = session.backend,
        match_app_id = %session.reducer.policy().needle(),
        match_mode = %session.reducer.policy().mode(),
        "focus loop running on dedicated connection"
    );
    session.entered = true;

    loop {
        if session.finished || session.stopped() {
            return Ok(());
        }
        pump(&mut queue, session).context("wayland dispatch")?;
        session.flush_batch();
    }
}

fn bind_outputs(globals: &GlobalList, qh: &QueueHandle<Session>, session: &mut Session) {
    let registry = globals.registry();
    for global in globals.contents().clone_list() {
        if global.interface != "wl_output" {
            continue;
        }
        let version = if global.version >= 4 {
            4
        } else {
            global.version.max(1)
        };
        let output: WlOutput = registry.bind(global.name, version, qh, ());
        session.outputs.push(output);
    }
}

fn bind_backend(
    globals: &GlobalList,
    qh: &QueueHandle<Session>,
    session: &mut Session,
) -> Result<()> {
    match globals.bind::<ZwlrForeignToplevelManagerV1, _, _>(qh, 1..=3, ()) {
        Ok(manager) => {
            session.backend = WLR_BACKEND;
            session.wlr_manager = Some(manager);
            return Ok(());
        }
        Err(wayland_client::globals::BindError::NotPresent) => {}
        Err(err) => return Err(err).context("bind zwlr_foreign_toplevel_manager_v1"),
    }

    match globals.bind::<OrgKdePlasmaWindowManagement, _, _>(qh, 7..=18, ()) {
        Ok(manager) => {
            session.backend = PLASMA_BACKEND;
            session.plasma_manager = Some(manager);
            Ok(())
        }
        Err(wayland_client::globals::BindError::NotPresent) => {
            bail!(
                "compositor has neither zwlr_foreign_toplevel_manager_v1 nor \
                 org_kde_plasma_window_management. On Plasma that global is privileged: \
                 the host writes ~/.local/share/applications/dev.roxysu.overlay.desktop \
                 (Exec = this binary, X-KDE-Wayland-Interfaces = org_kde_plasma_window_management) \
                 and refreshes the KDE service cache. Follow-focus stays unmapped until KWin grants it. \
                 --follow-focus=false forces an always-visible layer."
            )
        }
        Err(err) => Err(err).context("bind org_kde_plasma_window_management"),
    }
}

fn pump(queue: &mut EventQueue<Session>, session: &mut Session) -> Result<()> {
    queue
        .dispatch_pending(session)
        .context("dispatch pending")?;
    queue.flush().context("flush wayland")?;
    let Some(guard) = queue.prepare_read() else {
        queue
            .dispatch_pending(session)
            .context("dispatch pending")?;
        return Ok(());
    };
    if session.stopped() {
        drop(guard);
        return Ok(());
    }
    let mut fds = [libc::pollfd {
        fd: guard.connection_fd().as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    }];
    let rc = unsafe { libc::poll(fds.as_mut_ptr(), 1, PUMP_TIMEOUT_MS) };
    if rc < 0 {
        let err = std::io::Error::last_os_error();
        drop(guard);
        if err.kind() == std::io::ErrorKind::Interrupted {
            return Ok(());
        }
        return Err(err).context("poll wayland fd");
    }
    if rc == 0 {
        drop(guard);
        return Ok(());
    }
    if let Err(err) = guard.read() {
        if err.to_string().contains("WouldBlock") || err.to_string().contains("would block") {
            return Ok(());
        }
        return Err(err).context("read wayland events");
    }
    queue
        .dispatch_pending(session)
        .context("dispatch pending")?;
    Ok(())
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

impl Dispatch<WlOutput, ()> for Session {
    fn event(
        session: &mut Self,
        output: &WlOutput,
        event: wl_output::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let id = output.id().protocol_id();
        match event {
            wl_output::Event::Name { name } => session.note_output_name(id, name),
            wl_output::Event::Geometry { model, .. } => {
                if !model.is_empty() && !session.output_names.contains_key(&id) {
                    session.note_output_name(id, model);
                }
            }
            _ => {}
        }
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
                session.reducer.apply(ToplevelEvent::Title { id, title });
            }
            Event::AppId { app_id } => {
                session.reducer.apply(ToplevelEvent::AppId { id, app_id });
            }
            Event::State { state: states } => {
                let mut activated = false;
                let mut minimized = false;
                for chunk in states.chunks_exact(4) {
                    let v = u32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    if v == zwlr_foreign_toplevel_handle_v1::State::Activated as u32 {
                        activated = true;
                    } else if v == zwlr_foreign_toplevel_handle_v1::State::Minimized as u32 {
                        minimized = true;
                    }
                }
                session.reducer.apply(ToplevelEvent::State {
                    id,
                    activated,
                    minimized,
                });
            }
            Event::OutputEnter { output } => {
                session.output_entered(id, output.id().protocol_id());
            }
            Event::OutputLeave { output } => {
                session.output_left(id, output.id().protocol_id());
            }
            Event::Done => {}
            Event::Closed => {
                session.reducer.apply(ToplevelEvent::Closed(id));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::matching::MatchMode;

    fn list_session() -> Session {
        let (tx, _rx) = mpsc::channel();
        Session::list(MatchPolicy::new("osu", MatchMode::Contains), tx)
    }

    #[test]
    fn list_never_settles_without_toplevels() {
        let mut session = list_session();
        session.backend = PLASMA_BACKEND;
        session.plasma_pending_initial.clear();
        assert!(!session.list_settled(true));
    }

    #[test]
    fn plasma_list_settles_only_after_initial_state() {
        let mut session = list_session();
        session.backend = PLASMA_BACKEND;
        session.reducer.apply(ToplevelEvent::Added(ToplevelId(10)));
        session.plasma_pending_initial.insert(10);
        // Properties still in flight — a dump here would print empty
        // app_id/title fields.
        assert!(!session.list_settled(true));
        session.plasma_pending_initial.remove(&10);
        assert!(session.list_settled(true));
    }

    #[test]
    fn plasma_window_unmapped_after_adopt_keeps_the_dump_settleable() {
        let mut session = list_session();
        session.backend = PLASMA_BACKEND;
        session.reducer.apply(ToplevelEvent::Added(ToplevelId(10)));
        session.plasma_pending_initial.insert(10);
        // Unmapped during the dump: the window leaves the reducer and the
        // pending set, so a straggler cannot block settling forever.
        session.plasma_pending_initial.remove(&10);
        session.reducer.apply(ToplevelEvent::Closed(ToplevelId(10)));
        assert!(!session.list_settled(true)); // no toplevels left
        session.reducer.apply(ToplevelEvent::Added(ToplevelId(11)));
        assert!(session.list_settled(true));
    }

    #[test]
    fn wlr_list_settles_on_a_quiet_batch_only() {
        let mut session = list_session();
        session.backend = WLR_BACKEND;
        session.reducer.apply(ToplevelEvent::Added(ToplevelId(1)));
        // The toplevel arrived in this batch — not quiet yet.
        assert!(!session.list_settled(false));
        assert!(session.list_settled(true));
    }
}

