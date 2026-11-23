//! Read-only `org_kde_plasma_window_management` backend.
//!
//! Observe app id, title, resource name, state, and geometry. Do not send
//! `close`, `set_state`, move, resize, or desktop-change requests.

use wayland_client::{Connection, Dispatch, Proxy, QueueHandle};
use wayland_protocols_plasma::plasma_window_management::client::{
    org_kde_plasma_window::{self, OrgKdePlasmaWindow},
    org_kde_plasma_window_management::{self, OrgKdePlasmaWindowManagement, State},
};

use super::reducer::{OutputRect, ToplevelEvent, ToplevelId};
use super::wayland::Session;

impl Dispatch<OrgKdePlasmaWindowManagement, ()> for Session {
    fn event(
        session: &mut Self,
        manager: &OrgKdePlasmaWindowManagement,
        event: org_kde_plasma_window_management::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        use org_kde_plasma_window_management::Event;
        match event {
            Event::Window { id } => session.adopt_plasma_window(manager, qh, id, None),
            Event::WindowWithUuid { id, uuid } => {
                session.adopt_plasma_window(manager, qh, id, Some(uuid));
            }
            _ => {}
        }
    }
}

impl Dispatch<OrgKdePlasmaWindow, ()> for Session {
    fn event(
        session: &mut Self,
        window: &OrgKdePlasmaWindow,
        event: org_kde_plasma_window::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        use org_kde_plasma_window::Event;
        let id = ToplevelId(window.id().protocol_id());
        match event {
            Event::TitleChanged { title } => {
                session.reducer.apply(ToplevelEvent::Title { id, title });
            }
            Event::AppIdChanged { app_id } => {
                session.reducer.apply(ToplevelEvent::AppId { id, app_id });
            }
            Event::ResourceNameChanged { resource_name } => {
                session
                    .reducer
                    .apply(ToplevelEvent::ResourceName { id, resource_name });
            }
            Event::StateChanged { flags } => {
                let activated = (flags & (State::Active as u32)) != 0;
                let minimized = (flags & (State::Minimized as u32)) != 0;
                session.reducer.apply(ToplevelEvent::State {
                    id,
                    activated,
                    minimized,
                });
            }
            Event::Geometry {
                x,
                y,
                width,
                height,
            }
            | Event::ClientGeometry {
                x,
                y,
                width,
                height,
            } => {
                session.reducer.apply(ToplevelEvent::Bounds {
                    id,
                    rect: OutputRect {
                        x,
                        y,
                        width: width.min(i32::MAX as u32) as i32,
                        height: height.min(i32::MAX as u32) as i32,
                    },
                });
            }
            Event::Unmapped => {
                session.plasma_windows.remove(&id.0);
                session.reducer.apply(ToplevelEvent::Closed(id));
            }
            Event::InitialState => {}
            _ => {}
        }
    }
}

impl Session {
    pub(super) fn adopt_plasma_window(
        &mut self,
        manager: &OrgKdePlasmaWindowManagement,
        qh: &QueueHandle<Self>,
        internal_id: u32,
        uuid: Option<String>,
    ) {
        if !self.seen_plasma.insert(internal_id) {
            return;
        }
        let window = if manager.version() >= 12 {
            if let Some(uuid) = uuid {
                manager.get_window_by_uuid(uuid, qh, ())
            } else {
                manager.get_window(internal_id, qh, ())
            }
        } else {
            manager.get_window(internal_id, qh, ())
        };
        let id = ToplevelId(window.id().protocol_id());
        self.plasma_windows.insert(id.0, window);
        self.reducer.apply(ToplevelEvent::Added(id));
    }
}
