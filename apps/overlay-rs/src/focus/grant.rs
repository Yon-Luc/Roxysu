//! KWin only advertises `org_kde_plasma_window_management` to a client whose
//! canonical `/proc/self/exe` matches an installed `.desktop` `Exec=` that
//! lists the interface in `X-KDE-Wayland-Interfaces`.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use anyhow::{Context, Result};
use tracing::{info, warn};

const DESKTOP_FILE: &str = "dev.roxysu.overlay.desktop";

pub fn install_plasma_grant() {
    match install_inner() {
        Ok(Install::Unchanged) => {}
        Ok(Install::Wrote { path, refreshed }) => {
            info!(
                path = %path.display(),
                refreshed,
                "installed KWin window-management grant"
            );
        }
        Err(err) => {
            warn!(
                error = %err,
                "could not install the KWin window-management grant; Plasma follow-focus stays unmapped until it is visible"
            );
        }
    }
}

enum Install {
    Unchanged,
    Wrote { path: PathBuf, refreshed: bool },
}

fn install_inner() -> Result<Install> {
    let exe = fs::canonicalize("/proc/self/exe").context("canonicalize /proc/self/exe")?;
    let exec = exe.to_string_lossy();
    let body = desktop_entry(&exec);
    let dir = data_home()
        .context("neither XDG_DATA_HOME nor HOME is set")?
        .join("applications");
    fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let path = dir.join(DESKTOP_FILE);
    if path.is_file() {
        if fs::read_to_string(&path).ok().as_deref() == Some(body.as_str()) {
            return Ok(Install::Unchanged);
        }
    }
    fs::write(&path, &body).with_context(|| format!("write {}", path.display()))?;
    let refreshed = refresh_sycoca();
    Ok(Install::Wrote { path, refreshed })
}

fn data_home() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        let path = PathBuf::from(&xdg);
        if path.is_absolute() {
            return Some(path);
        }
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
}

fn refresh_sycoca() -> bool {
    for bin in ["kbuildsycoca6", "kbuildsycoca5"] {
        match Command::new(bin)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => return true,
            Ok(status) => {
                warn!(%bin, ?status, "KDE service cache rebuild failed");
                return false;
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                warn!(%bin, error = %err, "could not run KDE service cache rebuild");
                return false;
            }
        }
    }
    info!("kbuildsycoca6 is not on PATH; KWin may not see the grant until it rebuilds its service cache");
    false
}

/// Desktop entry whose `Exec` is the overlay binary, not the Electron app.
pub fn desktop_entry(exec: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Roxysu overlay\n\
         Comment=In-game HUD host for Roxysu\n\
         Exec={}\n\
         NoDisplay=true\n\
         StartupNotify=false\n\
         X-KDE-Wayland-Interfaces=org_kde_plasma_window_management\n",
        exec_field(exec),
    )
}

fn exec_field(path: &str) -> String {
    if path.contains([' ', '\t', '"', '\\']) {
        format!("\"{}\"", path.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::desktop_entry;

    #[test]
    fn entry_grants_plasma_window_management() {
        let text = desktop_entry("/nix/store/abc/bin/roxysu-overlay-rs");
        assert!(text.contains("Exec=/nix/store/abc/bin/roxysu-overlay-rs\n"));
        assert!(text.contains("X-KDE-Wayland-Interfaces=org_kde_plasma_window_management\n"));
        assert!(text.contains("NoDisplay=true\n"));
        assert!(!text.contains("close"));
    }

    #[test]
    fn entry_quotes_paths_with_spaces() {
        let text = desktop_entry("/home/me/My Overlay/roxysu-overlay-rs");
        assert!(text.contains("Exec=\"/home/me/My Overlay/roxysu-overlay-rs\"\n"));
    }
}
