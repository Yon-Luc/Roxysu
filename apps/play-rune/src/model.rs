//! Framework-neutral state shared by the Play shell, playfield, and overlay.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rune::native_surface::{ByteFrame, ColorInfo, Format};
use rune::{Live, LiveText, NativeSurface, Pixels, WindowHandle};

use crate::audio::Music;
use crate::catalog::{BeatmapRow, CatalogStatus};
use crate::chart::Chart;
use crate::gameplay::{GameplayEngine, GameplaySnapshot, InputEvent};
use crate::judge::Judgment;
use crate::keybinds;
use crate::playfield_raster::{self, FIELD_H, FIELD_W, HitFlash, PixelOrder, RasterArgs};
use crate::resources::ResourceMonitor;
use crate::settings::PlaySettings;
use crate::skin::PlaySkin;

const HUD_INTERVAL: Duration = Duration::from_millis(125);
const WINDOW_DEFAULT: (f32, f32) = (1100.0, 720.0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellTab {
    Library,
    Settings,
    Overlay,
    About,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresentSink {
    Pixels,
    NativeSurface,
}

impl PresentSink {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pixels => "Pixels",
            Self::NativeSurface => "NativeSurface",
        }
    }

    pub fn toggle(self) -> Self {
        match self {
            Self::Pixels => Self::NativeSurface,
            Self::NativeSurface => Self::Pixels,
        }
    }
}

#[derive(Clone, Debug)]
pub struct PlayResult {
    pub title: String,
    pub snapshot: GameplaySnapshot,
}

pub struct PlaySession {
    pub title: String,
    pub chart: Chart,
    pub engine: GameplayEngine,
    pub started: Instant,
    pub lead_in_ms: f64,
    pub keys_down: [bool; 7],
    pub pending_inputs: Vec<InputEvent>,
    pub last_judgment: Option<Judgment>,
    /// Atlas-backed playfield (PresentSink::Pixels).
    pub field: Pixels,
    /// Video-style playfield (PresentSink::NativeSurface).
    pub surface: NativeSurface,
    pub sink: PresentSink,
    pub hud_line: LiveText,
    pub judge_line: LiveText,
    pub perf_line: LiveText,
    pub res_line: LiveText,
    pub meta_line: LiveText,
    music: Option<Music>,
    audio_status: String,
    resources: ResourceMonitor,
    pub scroll_speed: f32,
    pub use_skin: bool,
    pub skin: Option<Arc<PlaySkin>>,
    pub playfield_scale: f32,
    pub hit_position: f32,
    /// Live offset so layout drag doesn't rebuild the view every frame.
    pub offset: Live<[f32; 2]>,
    pub lane_keys: [String; 7],
    pub layout_edit: bool,
    /// Start offset captured at layout-drag Down (x, y).
    drag_origin: Option<[f32; 2]>,
    flashes: Vec<HitFlash>,
    last_judgment_seq: u64,
    /// Triple pool: raster into a slot, move into the sink (no 1MB clone).
    bufs: [Vec<u8>; 3],
    buf_i: usize,
    frame_id: u64,
    last_frame_at: Option<Instant>,
    fps_ema: f64,
    raster_ms: f64,
    set_ms: f64,
    last_hud_at: Instant,
    rebuild: bool,
}

impl PlaySession {
    pub fn new(
        title: String,
        chart: Chart,
        engine: GameplayEngine,
        music: Option<Music>,
        settings: &PlaySettings,
    ) -> Self {
        let need = playfield_raster::buffer_bytes();
        let field = Pixels::new();
        let surface = NativeSurface::new();
        let mut bufs = [
            Vec::with_capacity(need),
            Vec::with_capacity(need),
            Vec::with_capacity(need),
        ];
        let scroll_speed = settings.scroll_speed;
        let use_skin = settings.use_skin && settings.skin.is_some();
        let skin = settings.skin.clone();
        let hit_position = settings.hit_position;
        let playfield_scale = settings.playfield_scale;
        let lane_keys = settings.lane_keys.clone();
        let offset = Live::new([settings.offset_x, settings.offset_y]);
        playfield_raster::rasterize(
            &mut bufs[0],
            RasterArgs {
                chart: &chart,
                engine: &engine,
                time_ms: -1200.0,
                keys_down: &[false; 7],
                order: PixelOrder::Rgba,
                scroll_speed,
                hit_position,
                flashes: &[],
                skin: if use_skin {
                    skin.as_deref()
                } else {
                    None
                },
            },
        );
        field.set(FIELD_W, FIELD_H, bufs[0].clone());
        let mut bgra = bufs[0].clone();
        swizzle_rgba_to_bgra_in_place(&mut bgra);
        let _ = surface.push_bytes(
            ByteFrame {
                width: FIELD_W,
                height: FIELD_H,
                format: Format::Bgra,
                color: ColorInfo::default(),
                planes: [bgra, Vec::new()],
            },
            0,
        );
        bufs[0] = Vec::with_capacity(need);
        let lead_in_ms = chart.audio_lead_in_ms.max(1200.0);
        let audio_status = match &music {
            Some(m) => m.label.clone(),
            None => "silent (no audio)".into(),
        };
        let meta_line = LiveText::new(format!(
            "scroll {:.0} · scale {:.0}% · hit {:.0}% · {} · [ ] speed · I skin",
            scroll_speed,
            playfield_scale * 100.0,
            hit_position * 100.0,
            if use_skin {
                skin.as_ref()
                    .map(|s| format!("skin:{}", s.name))
                    .unwrap_or_else(|| "skin:?".into())
            } else {
                "skin:off".into()
            }
        ));
        Self {
            title,
            chart,
            engine,
            started: Instant::now(),
            lead_in_ms,
            keys_down: [false; 7],
            pending_inputs: Vec::new(),
            last_judgment: None,
            field,
            surface,
            sink: PresentSink::Pixels,
            hud_line: LiveText::new("—"),
            judge_line: LiveText::new("—"),
            perf_line: LiveText::new("— fps · — · Pixels · press P to toggle sink"),
            res_line: LiveText::new("rss — · cpu — · gpu — · —"),
            meta_line,
            music,
            audio_status,
            resources: ResourceMonitor::new(),
            scroll_speed,
            use_skin,
            skin,
            playfield_scale,
            hit_position,
            offset,
            lane_keys,
            layout_edit: settings.layout_edit,
            drag_origin: None,
            flashes: Vec::new(),
            last_judgment_seq: 0,
            bufs,
            buf_i: 0,
            frame_id: 1,
            last_frame_at: None,
            fps_ema: 0.0,
            raster_ms: 0.0,
            set_ms: 0.0,
            last_hud_at: Instant::now() - HUD_INTERVAL,
            rebuild: false,
        }
    }

    pub fn display_size(&self) -> (f32, f32) {
        playfield_raster::display_size(self.playfield_scale)
    }

    pub fn bindings_hint(&self) -> String {
        keybinds::format_bindings_hint(&self.lane_keys)
    }

    pub fn sync_settings_into(&self, settings: &mut PlaySettings) {
        settings.scroll_speed = self.scroll_speed;
        settings.use_skin = self.use_skin;
        settings.playfield_scale = self.playfield_scale;
        settings.hit_position = self.hit_position;
        let [ox, oy] = self.offset.get();
        settings.offset_x = ox;
        settings.offset_y = oy;
        settings.lane_keys = self.lane_keys.clone();
        settings.layout_edit = self.layout_edit;
    }

    pub fn nudge_scale(&mut self, delta: f32) {
        self.playfield_scale = PlaySettings::clamp_scale(self.playfield_scale + delta);
        self.rebuild = true;
        self.publish_meta();
    }

    pub fn nudge_hit_position(&mut self, delta: f32) {
        self.hit_position = PlaySettings::clamp_hit_position(self.hit_position + delta);
        self.publish_meta();
    }

    pub fn toggle_layout_edit(&mut self) {
        self.layout_edit = !self.layout_edit;
        self.drag_origin = None;
        self.rebuild = true;
        self.publish_meta();
    }

    pub fn begin_layout_drag(&mut self) {
        self.drag_origin = Some(self.offset.get());
    }

    pub fn apply_layout_drag(&mut self, dx: f32, dy: f32) {
        let Some([ox, oy]) = self.drag_origin else {
            return;
        };
        self.offset.set([
            (ox + dx).clamp(-800.0, 800.0),
            (oy + dy).clamp(-600.0, 600.0),
        ]);
    }

    pub fn drag_origin_peek(&self) -> Option<[f32; 2]> {
        self.drag_origin
    }

    pub fn end_layout_drag(&mut self) {
        self.drag_origin = None;
    }

    pub fn nudge_scroll(&mut self, delta: f32) {
        self.scroll_speed = PlaySettings::clamp_scroll(self.scroll_speed + delta);
        self.publish_meta();
    }

    pub fn toggle_skin(&mut self) {
        if self.skin.is_none() {
            return;
        }
        self.use_skin = !self.use_skin;
        self.publish_meta();
    }

    /// Gameplay clock is always wall time (stable, vsync-paced). Audio follows it.
    pub fn song_time_ms(&mut self) -> f64 {
        let wall = self.started.elapsed().as_secs_f64() * 1000.0 - self.lead_in_ms;
        if let Some(music) = self.music.as_mut() {
            music.sync_start(wall);
        }
        wall
    }

    pub fn stop_audio(&mut self) {
        if let Some(music) = self.music.take() {
            music.stop();
        }
    }

    /// Switch Pixels ↔ NativeSurface; next poll rebuilds the field element.
    pub fn toggle_sink(&mut self) {
        self.sink = self.sink.toggle();
        self.rebuild = true;
        self.publish_perf();
    }

    /// Advance gameplay + raster. Returns (snapshot, view_dirty).
    pub fn tick(&mut self) -> (GameplaySnapshot, bool) {
        let frame_start = Instant::now();
        if let Some(prev) = self.last_frame_at {
            let dt = frame_start.saturating_duration_since(prev).as_secs_f64();
            if dt > 0.0 {
                let sample = 1.0 / dt;
                self.fps_ema = if self.fps_ema <= 0.0 {
                    sample
                } else {
                    self.fps_ema * 0.9 + sample * 0.1
                };
            }
        }
        self.last_frame_at = Some(frame_start);

        let t = self.song_time_ms();
        let inputs = std::mem::take(&mut self.pending_inputs);
        self.engine.update(t, &inputs);
        let snap = self.engine.snapshot(t);
        self.last_judgment = snap.last_judgment;
        if snap.judgment_seq != self.last_judgment_seq {
            self.last_judgment_seq = snap.judgment_seq;
            if let (Some(judgment), Some(lane)) = (snap.last_judgment, snap.last_judgment_lane) {
                self.flashes.push(HitFlash {
                    lane,
                    judgment,
                    born_ms: t,
                });
                if self.flashes.len() > 24 {
                    let drop = self.flashes.len() - 24;
                    self.flashes.drain(0..drop);
                }
            }
        }
        self.flashes
            .retain(|f| t - f.born_ms <= playfield_raster::HIT_FLASH_MS);

        let order = match self.sink {
            PresentSink::Pixels => PixelOrder::Rgba,
            PresentSink::NativeSurface => PixelOrder::Bgra,
        };
        let i = self.buf_i;
        self.buf_i = (i + 1) % self.bufs.len();
        let need = playfield_raster::buffer_bytes();
        let mut buf = std::mem::take(&mut self.bufs[i]);
        if buf.capacity() < need {
            buf = Vec::with_capacity(need);
        }

        let skin = if self.use_skin {
            self.skin.as_deref()
        } else {
            None
        };
        let raster_start = Instant::now();
        playfield_raster::rasterize(
            &mut buf,
            RasterArgs {
                chart: &self.chart,
                engine: &self.engine,
                time_ms: t,
                keys_down: &self.keys_down,
                order,
                scroll_speed: self.scroll_speed,
                hit_position: self.hit_position,
                flashes: &self.flashes,
                skin,
            },
        );
        self.raster_ms = raster_start.elapsed().as_secs_f64() * 1000.0;

        let set_start = Instant::now();
        match self.sink {
            PresentSink::Pixels => {
                self.field.set(FIELD_W, FIELD_H, buf);
            }
            PresentSink::NativeSurface => {
                self.frame_id = self.frame_id.wrapping_add(1);
                let _ = self.surface.push_bytes(
                    ByteFrame {
                        width: FIELD_W,
                        height: FIELD_H,
                        format: Format::Bgra,
                        color: ColorInfo::default(),
                        planes: [buf, Vec::new()],
                    },
                    self.frame_id,
                );
            }
        }
        // Slot ready for reuse in 3 frames (Pixels/NativeSurface own the moved Vec until then).
        self.bufs[i] = Vec::with_capacity(need);
        self.set_ms = set_start.elapsed().as_secs_f64() * 1000.0;

        let force_hud = self.rebuild;
        if force_hud || self.last_hud_at.elapsed() >= HUD_INTERVAL {
            self.hud_line.set(format!(
                "{:.1}%  ·  {}x  ·  score {}  ·  {:.0}ms",
                snap.accuracy * 100.0,
                snap.combo,
                snap.score,
                t.max(0.0)
            ));
            self.publish_perf();
            self.publish_resources();
            self.last_hud_at = Instant::now();
        }
        if let Some(j) = snap.last_judgment {
            self.judge_line.set(j.label());
        }

        let dirty = self.rebuild;
        self.rebuild = false;
        (snap, dirty)
    }

    fn publish_perf(&self) {
        self.perf_line.set(format!(
            "{:.0} fps · raster {:.2}ms · set {:.2}ms · {} · P sink",
            self.fps_ema,
            self.raster_ms,
            self.set_ms,
            self.sink.label()
        ));
    }

    fn publish_meta(&self) {
        let skin = if self.use_skin {
            self.skin
                .as_ref()
                .map(|s| format!("skin:{}", s.name))
                .unwrap_or_else(|| "skin:?".into())
        } else {
            "skin:off".into()
        };
        let layout = if self.layout_edit { "layout:edit" } else { "layout:lock" };
        self.meta_line.set(format!(
            "scroll {:.0} · scale {:.0}% · hit {:.0}% · {skin} · {layout}",
            self.scroll_speed,
            self.playfield_scale * 100.0,
            self.hit_position * 100.0,
        ));
    }

    fn publish_resources(&mut self) {
        let sample = self.resources.sample();
        let gpu = match sample.gpu_mb {
            Some(mb) => format!("{mb:.0}MB {}", sample.gpu_label),
            None => sample.gpu_label.to_string(),
        };
        self.res_line.set(format!(
            "rss {:.0}MB · cpu {:.0}% · {} · {}",
            sample.rss_mb, sample.cpu_pct, gpu, self.audio_status
        ));
    }

}

fn swizzle_rgba_to_bgra_in_place(buf: &mut [u8]) {
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
}

pub enum Phase {
    Shell,
    Playing(PlaySession),
    Results(PlayResult),
}

#[derive(Clone, Debug)]
pub struct AppSnapshot {
    pub tick: u64,
    pub status: String,
    pub overlay_visible: bool,
    pub click_through: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum AppCommand {
    SetOverlayVisible(bool),
    SetClickThrough(bool),
}

#[derive(Clone)]
pub struct Shared {
    pub overlays: Arc<Mutex<Vec<WindowHandle>>>,
    pub control: Arc<Mutex<Option<WindowHandle>>>,
    pub telemetry: LiveText,
    pub tick: Arc<Mutex<u64>>,
    pub overlay_visible: Arc<AtomicBool>,
    pub click_through: Arc<AtomicBool>,
    pub click_through_error: Arc<Mutex<String>>,
    /// When true, fake overlay telemetry sleeps (playfield owns the frame budget).
    pub playing: Arc<AtomicBool>,
    /// Primary display logical size for near-fullscreen resize (Rune has no set_fullscreen yet).
    pub display_size: Arc<Mutex<(f32, f32)>>,
    pub fullscreen: Arc<AtomicBool>,
    pub window_restored: Arc<Mutex<(f32, f32)>>,
}

impl Shared {
    pub fn new() -> Self {
        Self {
            overlays: Arc::new(Mutex::new(Vec::new())),
            control: Arc::new(Mutex::new(None)),
            telemetry: LiveText::new("tick=0 · waiting"),
            tick: Arc::new(Mutex::new(0)),
            overlay_visible: Arc::new(AtomicBool::new(true)),
            click_through: Arc::new(AtomicBool::new(true)),
            click_through_error: Arc::new(Mutex::new(String::new())),
            playing: Arc::new(AtomicBool::new(false)),
            display_size: Arc::new(Mutex::new((1920.0, 1080.0))),
            fullscreen: Arc::new(AtomicBool::new(false)),
            window_restored: Arc::new(Mutex::new(WINDOW_DEFAULT)),
        }
    }

    pub fn set_display_size(&self, size: (f32, f32)) {
        *self.display_size.lock().expect("display size lock") = size;
    }

    /// Toggle maximized-style window size via `WindowHandle::resize` (borderless fullscreen
    /// is not exposed by Rune's public API yet).
    pub fn toggle_fullscreen(&self) -> bool {
        let Some(window) = self.control.lock().expect("control lock").clone() else {
            return self.fullscreen.load(Ordering::Relaxed);
        };
        let next = !self.fullscreen.load(Ordering::Relaxed);
        if next {
            let size = *self.display_size.lock().expect("display size lock");
            window.resize(size);
        } else {
            let size = *self.window_restored.lock().expect("restored size lock");
            window.resize(size);
        }
        self.fullscreen.store(next, Ordering::Relaxed);
        next
    }

    pub fn is_fullscreen(&self) -> bool {
        self.fullscreen.load(Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> AppSnapshot {
        let tick = *self.tick.lock().expect("tick lock");
        AppSnapshot {
            tick,
            status: self.telemetry.get().to_string(),
            overlay_visible: self.overlay_visible.load(Ordering::Relaxed),
            click_through: self.click_through.load(Ordering::Relaxed),
        }
    }

    pub fn apply(&self, command: AppCommand) {
        match command {
            AppCommand::SetOverlayVisible(visible) => {
                self.overlay_visible.store(visible, Ordering::Relaxed);
                let overlays = self.overlays.lock().expect("overlays lock");
                for window in overlays.iter() {
                    if visible {
                        window.show();
                    } else {
                        window.hide();
                    }
                }
            }
            AppCommand::SetClickThrough(click_through) => {
                self.click_through.store(click_through, Ordering::Relaxed);
                let overlays = self.overlays.lock().expect("overlays lock");
                let mut last_error = String::new();
                for window in overlays.iter() {
                    if let Err(error) = window.set_click_through(click_through) {
                        eprintln!("click-through: {error}");
                        last_error = error;
                    }
                }
                *self.click_through_error.lock().expect("error lock") = last_error;
            }
        }
    }

    pub fn publish_tick(&self, tick: u64) {
        *self.tick.lock().expect("tick lock") = tick;
        self.telemetry
            .set(format!("tick={tick} · fake telemetry ok"));
    }
}

pub struct State {
    pub overlay: bool,
    pub shared: Shared,
    pub overlay_visible: bool,
    pub click_through: bool,
    pub tab: ShellTab,
    pub selected: usize,
    pub start_hint: String,
    pub catalog: Vec<BeatmapRow>,
    pub catalog_status: CatalogStatus,
    pub phase: Phase,
    pub playing: Arc<AtomicBool>,
    pub settings: PlaySettings,
    /// When `Some(lane)`, the next physical key remaps that lane in Settings.
    pub rebinding_lane: Option<usize>,
    pub settings_hint: String,
}

fn default_play_settings() -> PlaySettings {
    let mut settings = PlaySettings::default();
    match crate::skin::load_preferred() {
        Ok(skin) => {
            let status = format!(
                "loaded {} ({} notes) — I toggles in play",
                skin.name,
                skin.note_count()
            );
            settings.set_skin(Some(skin), status);
        }
        Err(err) => {
            settings.set_skin(None, err);
        }
    }
    settings
}

impl Drop for State {
    fn drop(&mut self) {
        if !self.overlay {
            for window in self.shared.overlays.lock().expect("overlays lock").iter() {
                window.close();
            }
        }
    }
}

pub fn dummy_init() -> State {
    let shared = Shared::new();
    let playing = shared.playing.clone();
    let (catalog_status, catalog) = crate::catalog::load_default();
    State {
        overlay: false,
        shared,
        overlay_visible: true,
        click_through: true,
        tab: ShellTab::Library,
        selected: 0,
        start_hint: String::new(),
        catalog,
        catalog_status,
        phase: Phase::Shell,
        playing,
        settings: default_play_settings(),
        rebinding_lane: None,
        settings_hint: String::new(),
    }
}

pub fn control_state(shared: Shared) -> State {
    let snap = shared.snapshot();
    let playing = shared.playing.clone();
    let (catalog_status, catalog) = crate::catalog::load_default();
    State {
        overlay: false,
        overlay_visible: snap.overlay_visible,
        click_through: snap.click_through,
        shared,
        tab: ShellTab::Library,
        selected: 0,
        start_hint: String::new(),
        catalog,
        catalog_status,
        phase: Phase::Shell,
        playing,
        settings: default_play_settings(),
        rebinding_lane: None,
        settings_hint: String::new(),
    }
}

pub fn overlay_state(shared: Shared) -> State {
    let snap = shared.snapshot();
    let playing = shared.playing.clone();
    State {
        overlay: true,
        overlay_visible: snap.overlay_visible,
        click_through: snap.click_through,
        shared,
        tab: ShellTab::Library,
        selected: 0,
        start_hint: String::new(),
        catalog: Vec::new(),
        catalog_status: CatalogStatus {
            db_path: String::new(),
            ok: true,
            message: String::new(),
            total_mania_7k: 0,
            listed: 0,
        },
        phase: Phase::Shell,
        playing,
        settings: PlaySettings::default(),
        rebinding_lane: None,
        settings_hint: String::new(),
    }
}
