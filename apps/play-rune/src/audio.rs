//! Chart audio via rodio (lazer `files/` blob).
//!
//! Playback is aligned to the gameplay wall clock but does **not** drive it —
//! rodio `get_pos()` updates in audio-buffer steps and would stutter the playfield.

use std::fs::File;
use std::path::Path;

use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player};

pub struct Music {
    /// Keep the device sink alive for the duration of play.
    _device: MixerDeviceSink,
    player: Player,
    started: bool,
    pub label: String,
}

impl Music {
    pub fn try_open(path: &Path) -> Result<Self, String> {
        if !path.is_file() {
            return Err(format!("audio missing: {}", path.display()));
        }
        let device = DeviceSinkBuilder::open_default_sink()
            .map_err(|e| format!("audio device: {e}"))?;
        let player = Player::connect_new(device.mixer());
        let file = File::open(path).map_err(|e| format!("open audio: {e}"))?;
        let source = Decoder::try_from(file).map_err(|e| format!("decode audio: {e}"))?;
        player.append(source);
        player.pause();
        Ok(Self {
            _device: device,
            player,
            started: false,
            label: format!(
                "audio {}",
                path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
            ),
        })
    }

    /// Start playback once song time reaches 0 (after lead-in). Wall clock stays authoritative.
    pub fn sync_start(&mut self, song_time_ms: f64) {
        if self.started || song_time_ms < 0.0 {
            return;
        }
        self.player.play();
        self.started = true;
    }

    pub fn stop(&self) {
        self.player.stop();
    }
}

impl Drop for Music {
    fn drop(&mut self) {
        self.player.stop();
    }
}
