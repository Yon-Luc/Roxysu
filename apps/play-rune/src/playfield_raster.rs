//! CPU playfield raster — avoids rebuilding hundreds of Rune els every frame.
//!
//! Internal resolution is half of the on-screen box; Rune scales the `Pixels` /
//! `NativeSurface` up. Scroll speed matches GPUIX (px/s at display size).

use crate::chart::{Chart, NoteKind};
use crate::gameplay::GameplayEngine;
use crate::judge::Judgment;
use crate::skin::{PlaySkin, RgbaSprite};

/// GPU/CPU buffer size (texels).
pub const FIELD_W: u32 = 210;
pub const FIELD_H: u32 = 280;
/// On-screen layout size (points) — 2× the raster for a sharp-enough upscale.
pub const DISPLAY_W: f32 = 420.0;
pub const DISPLAY_H: f32 = 560.0;

pub const TAP_H: f32 = 8.0;
pub const HIT_FLASH_MS: f64 = 220.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelOrder {
    Rgba,
    Bgra,
}

/// Short-lived lane lighting after a judgment (osu!mania-like hit feedback).
#[derive(Clone, Copy, Debug)]
pub struct HitFlash {
    pub lane: u8,
    pub judgment: Judgment,
    pub born_ms: f64,
}

const BG: [u8; 4] = [12, 14, 18, 255];
const LANE_LINE: [u8; 4] = [32, 36, 44, 255];
const RECEPTOR: [u8; 4] = [90, 96, 110, 255];
const RECEPTOR_HOT: [u8; 4] = [255, 80, 160, 255];
const NOTE: [u8; 4] = [255, 90, 170, 255];
const HOLD: [u8; 4] = [180, 50, 120, 255];

pub fn buffer_bytes() -> usize {
    FIELD_W as usize * FIELD_H as usize * 4
}

pub fn display_size(scale: f32) -> (f32, f32) {
    (DISPLAY_W * scale, DISPLAY_H * scale)
}

pub fn receptor_y(hit_position: f32) -> f32 {
    (hit_position.clamp(0.55, 0.95) * FIELD_H as f32).clamp(TAP_H + 4.0, FIELD_H as f32 - 16.0)
}

/// GPUIX uses `scrollSpeed / 1000` px/ms at full playfield height; scale to raster.
pub fn pixels_per_ms(scroll_speed: f32) -> f32 {
    (scroll_speed / 1000.0) * (FIELD_H as f32 / DISPLAY_H)
}

pub fn visible_ahead_ms(scroll_speed: f32, receptor_y: f32) -> f64 {
    let ppm = pixels_per_ms(scroll_speed) as f64;
    if ppm <= 1e-6 {
        return 2000.0;
    }
    (f64::from(receptor_y) / ppm) + 80.0
}

pub fn visible_behind_ms(scroll_speed: f32) -> f64 {
    let ppm = pixels_per_ms(scroll_speed) as f64;
    if ppm <= 1e-6 {
        return 200.0;
    }
    (f64::from(TAP_H) / ppm) + 80.0
}

fn judgment_rgba(j: Judgment) -> [u8; 4] {
    match j {
        Judgment::Perfect => [120, 220, 255, 255],
        Judgment::Great => [90, 200, 120, 255],
        Judgment::Good => [220, 200, 80, 255],
        Judgment::Ok => [220, 140, 60, 255],
        Judgment::Meh => [200, 90, 90, 255],
        Judgment::Miss => [180, 40, 50, 255],
    }
}

pub struct RasterArgs<'a> {
    pub chart: &'a Chart,
    pub engine: &'a GameplayEngine,
    pub time_ms: f64,
    pub keys_down: &'a [bool; 7],
    pub order: PixelOrder,
    pub scroll_speed: f32,
    /// Receptor Y as a fraction of playfield height.
    pub hit_position: f32,
    pub flashes: &'a [HitFlash],
    /// When set, blit note/key sprites instead of solid fills.
    pub skin: Option<&'a PlaySkin>,
}

pub fn rasterize(buf: &mut Vec<u8>, args: RasterArgs<'_>) {
    let w = FIELD_W as usize;
    let h = FIELD_H as usize;
    let need = buffer_bytes();
    if buf.capacity() < need {
        buf.reserve(need - buf.capacity());
    }
    buf.resize(need, 0);
    fill_u32(buf, pack(BG, args.order));

    let lane_w = FIELD_W as f32 / 7.0;
    let receptor_y = receptor_y(args.hit_position);
    let ppm = pixels_per_ms(args.scroll_speed);
    let ahead = visible_ahead_ms(args.scroll_speed, receptor_y);
    let behind = visible_behind_ms(args.scroll_speed);
    let lane_line = pack(LANE_LINE, args.order);
    let note = pack(NOTE, args.order);
    let hold = pack(HOLD, args.order);
    let receptor = pack(RECEPTOR, args.order);
    let receptor_hot = pack(RECEPTOR_HOT, args.order);

    for lane in 1..7u32 {
        let x = (lane as f32 * lane_w) as i32;
        fill_rect_opaque(buf, w, h, x, 0, 1, h as i32, lane_line);
    }

    // osu!mania-like column lighting under notes (fades out after each hit).
    for flash in args.flashes {
        let age = args.time_ms - flash.born_ms;
        if age < 0.0 || age > HIT_FLASH_MS {
            continue;
        }
        let t = 1.0 - (age / HIT_FLASH_MS) as f32;
        let mut rgba = judgment_rgba(flash.judgment);
        rgba[3] = (t * 140.0) as u8;
        let x0 = (f32::from(flash.lane) * lane_w) as i32;
        let nw = lane_w.ceil() as i32;
        let flash_h = ((receptor_y * 0.55) * t).max(8.0) as i32;
        let y0 = (receptor_y as i32 - flash_h).max(0);
        blend_rect(buf, w, h, x0, y0, nw, flash_h, rgba, args.order);
    }

    let t0 = args.time_ms - behind;
    let t1 = args.time_ms + ahead;
    let start_i = lower_bound_start(&args.chart.notes, t0);

    for i in start_i..args.chart.notes.len() {
        let n = &args.chart.notes[i];
        if n.start_ms > t1 {
            break;
        }
        if n.end_ms < t0 {
            continue;
        }
        if args.engine.is_hidden(i) {
            continue;
        }

        let col = n.column as usize;
        let x0 = (f32::from(n.column) * lane_w + 1.5) as i32;
        let nw = (lane_w - 3.0) as i32;
        match n.kind {
            NoteKind::Tap => {
                let y =
                    (receptor_y - ((n.start_ms - args.time_ms) as f32) * ppm - TAP_H) as i32;
                if let Some(sprite) = args.skin.and_then(|s| s.notes[col].as_ref()) {
                    blit_scaled(buf, w, h, x0, y, nw, TAP_H as i32, sprite, args.order);
                } else {
                    fill_rect_opaque(buf, w, h, x0, y, nw, TAP_H as i32, note);
                }
            }
            NoteKind::Hold => {
                let y_head = receptor_y - ((n.start_ms - args.time_ms) as f32) * ppm;
                let y_tail = receptor_y - ((n.end_ms - args.time_ms) as f32) * ppm;
                let top = y_tail.min(y_head) as i32;
                let height = ((y_head - y_tail).abs().max(TAP_H)) as i32;
                let body_w = (nw as f32 * 0.55) as i32;
                let body_x = x0 + (nw - body_w) / 2;
                if let Some(sprite) = args.skin.and_then(|s| s.bodies[col].as_ref()) {
                    blit_scaled(buf, w, h, body_x, top, body_w, height, sprite, args.order);
                } else {
                    fill_rect_opaque(buf, w, h, body_x, top, body_w, height, hold);
                }
                let hy = (y_head - TAP_H) as i32;
                if let Some(sprite) = args.skin.and_then(|s| s.notes[col].as_ref()) {
                    blit_scaled(buf, w, h, x0, hy, nw, TAP_H as i32, sprite, args.order);
                } else {
                    fill_rect_opaque(buf, w, h, x0, hy, nw, TAP_H as i32, note);
                }
            }
        }
    }

    for lane in 0..7u8 {
        let col = lane as usize;
        let x0 = (f32::from(lane) * lane_w + 2.0) as i32;
        let nw = (lane_w - 4.0) as i32;
        let hot = args.keys_down[col];
        let key_h = 12i32;
        let y = receptor_y as i32;
        if let Some(skin) = args.skin {
            let sprite = if hot {
                skin.keys_down[col].as_ref().or(skin.keys_up[col].as_ref())
            } else {
                skin.keys_up[col].as_ref()
            };
            if let Some(sprite) = sprite {
                blit_scaled(buf, w, h, x0, y, nw, key_h, sprite, args.order);
                continue;
            }
        }
        let color = if hot { receptor_hot } else { receptor };
        fill_rect_opaque(buf, w, h, x0, y, nw, 4, color);
    }

    // Bright receptor burst on recent hits.
    for flash in args.flashes {
        let age = args.time_ms - flash.born_ms;
        if age < 0.0 || age > HIT_FLASH_MS * 0.55 {
            continue;
        }
        let t = 1.0 - (age / (HIT_FLASH_MS * 0.55)) as f32;
        let mut rgba = judgment_rgba(flash.judgment);
        rgba[3] = (t * 220.0) as u8;
        let x0 = (f32::from(flash.lane) * lane_w + 1.0) as i32;
        let nw = (lane_w - 2.0) as i32;
        let burst_h = (10.0 + 18.0 * t) as i32;
        let y0 = receptor_y as i32 - burst_h / 2;
        blend_rect(buf, w, h, x0, y0, nw, burst_h, rgba, args.order);
    }
}

fn blend_rect(
    buf: &mut [u8],
    w: usize,
    h: usize,
    x: i32,
    y: i32,
    rw: i32,
    rh: i32,
    rgba: [u8; 4],
    order: PixelOrder,
) {
    if rw <= 0 || rh <= 0 || rgba[3] == 0 {
        return;
    }
    let x0 = x.max(0) as usize;
    let y0 = y.max(0) as usize;
    let x1 = (x + rw).clamp(0, w as i32) as usize;
    let y1 = (y + rh).clamp(0, h as i32) as usize;
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let a = u32::from(rgba[3]);
    let (sr, sg, sb) = match order {
        PixelOrder::Rgba => (rgba[0], rgba[1], rgba[2]),
        PixelOrder::Bgra => (rgba[2], rgba[1], rgba[0]),
    };
    for row in y0..y1 {
        for col in x0..x1 {
            let di = (row * w + col) * 4;
            buf[di] = (((255 - a) * u32::from(buf[di]) + a * u32::from(sr)) / 255) as u8;
            buf[di + 1] = (((255 - a) * u32::from(buf[di + 1]) + a * u32::from(sg)) / 255) as u8;
            buf[di + 2] = (((255 - a) * u32::from(buf[di + 2]) + a * u32::from(sb)) / 255) as u8;
            buf[di + 3] = 255;
        }
    }
}

fn pack(rgba: [u8; 4], order: PixelOrder) -> u32 {
    match order {
        PixelOrder::Rgba => u32::from_le_bytes(rgba),
        PixelOrder::Bgra => u32::from_le_bytes([rgba[2], rgba[1], rgba[0], rgba[3]]),
    }
}

fn lower_bound_start(notes: &[crate::chart::ChartNote], t0: f64) -> usize {
    let mut lo = 0usize;
    let mut hi = notes.len();
    while lo < hi {
        let mid = (lo + hi) / 2;
        if notes[mid].start_ms < t0 - 5000.0 {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo.saturating_sub(32)
}

fn fill_u32(buf: &mut [u8], word: u32) {
    let n = buf.len() / 4;
    let words = unsafe { std::slice::from_raw_parts_mut(buf.as_mut_ptr().cast::<u32>(), n) };
    words.fill(word);
}

fn fill_rect_opaque(buf: &mut [u8], w: usize, h: usize, x: i32, y: i32, rw: i32, rh: i32, word: u32) {
    if rw <= 0 || rh <= 0 {
        return;
    }
    let x0 = x.max(0) as usize;
    let y0 = y.max(0) as usize;
    let x1 = (x + rw).clamp(0, w as i32) as usize;
    let y1 = (y + rh).clamp(0, h as i32) as usize;
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let words = unsafe { std::slice::from_raw_parts_mut(buf.as_mut_ptr().cast::<u32>(), w * h) };
    for row in y0..y1 {
        let row_off = row * w;
        words[row_off + x0..row_off + x1].fill(word);
    }
}

/// Nearest-neighbour blit with source-over for translucent texels.
fn blit_scaled(
    dst: &mut [u8],
    dw: usize,
    dh: usize,
    dx: i32,
    dy: i32,
    dw_px: i32,
    dh_px: i32,
    sprite: &RgbaSprite,
    order: PixelOrder,
) {
    if dw_px <= 0 || dh_px <= 0 || sprite.width == 0 || sprite.height == 0 {
        return;
    }
    let x0 = dx.max(0) as usize;
    let y0 = dy.max(0) as usize;
    let x1 = (dx + dw_px).clamp(0, dw as i32) as usize;
    let y1 = (dy + dh_px).clamp(0, dh as i32) as usize;
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let sw = sprite.width as i32;
    let sh = sprite.height as i32;
    for y in y0..y1 {
        let sy = ((y as i32 - dy) * sh) / dh_px;
        let sy = sy.clamp(0, sh - 1) as usize;
        for x in x0..x1 {
            let sx = ((x as i32 - dx) * sw) / dw_px;
            let sx = sx.clamp(0, sw - 1) as usize;
            let si = (sy * sprite.width as usize + sx) * 4;
            let sr = sprite.rgba[si];
            let sg = sprite.rgba[si + 1];
            let sb = sprite.rgba[si + 2];
            let sa = sprite.rgba[si + 3];
            if sa == 0 {
                continue;
            }
            let di = (y * dw + x) * 4;
            let (r, g, b) = match order {
                PixelOrder::Rgba => (sr, sg, sb),
                PixelOrder::Bgra => (sb, sg, sr),
            };
            if sa == 255 {
                dst[di] = r;
                dst[di + 1] = g;
                dst[di + 2] = b;
                dst[di + 3] = 255;
            } else {
                let a = u32::from(sa);
                dst[di] = (((255 - a) * u32::from(dst[di]) + a * u32::from(r)) / 255) as u8;
                dst[di + 1] =
                    (((255 - a) * u32::from(dst[di + 1]) + a * u32::from(g)) / 255) as u8;
                dst[di + 2] =
                    (((255 - a) * u32::from(dst[di + 2]) + a * u32::from(b)) / 255) as u8;
                dst[di + 3] = 255;
            }
        }
    }
}
