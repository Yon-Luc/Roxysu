//! KWin only advertises `org_kde_plasma_window_management` to a client whose
//! canonical `/proc/self/exe` matches an installed `.desktop` `Exec=` that
//! lists the interface in `X-KDE-Wayland-Interfaces`.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use anyhow::{Context, Result};
use tracing::{info, warn};

const DESKTOP_FILE: &str = "dev.roxysu.overlay.desktop";

/// Result of [`install_plasma_grant`] (N1). The caller passes "was it just
/// written" into the focus loop so the first bind retries quickly while
/// KWin's service cache picks the entry up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantOutcome {
    /// No grant attempted (`--follow-focus=false` without `--list-windows`).
    NotAttempted,
    /// The desktop file already had the exact expected body.
    Unchanged,
    /// Writing or refreshing failed (already logged with guidance).
    Failed,
    /// File written or rewritten this run; `refreshed` = a service-cache
    /// rebuild ran.
    Wrote { refreshed: bool },
}

impl GrantOutcome {
    /// True when this run wrote or rewrote the grant file. KWin may need a
    /// moment (or a sycoca pickup) before it advertises the privileged
    /// global, so the first focus connect retries fast after a fresh write.
    pub fn wrote_fresh(&self) -> bool {
        matches!(self, Self::Wrote { .. })
    }
}

pub fn install_plasma_grant() -> GrantOutcome {
    match install_inner() {
        Ok(Install::Unchanged) => GrantOutcome::Unchanged,
        Ok(Install::Wrote { path, refreshed }) => {
            info!(
                path = %path.display(),
                refreshed,
                "installed KWin window-management grant"
            );
            GrantOutcome::Wrote { refreshed }
        }
        Err(err) => {
            warn!(
                error = %err,
                "could not install the KWin window-management grant; Plasma follow-focus stays unmapped until it is visible"
            );
            GrantOutcome::Failed
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

/// `kbuildsycoca` names, newest first.
const SYCOCA_BINS: [&str; 2] = ["kbuildsycoca6", "kbuildsycoca5"];

/// A packaged desktop shell often runs with a minimal PATH, so PATH alone
/// can miss the tool. After PATH, try the usual NixOS / home-manager /
/// distro locations (N1).
fn sycoca_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = SYCOCA_BINS.iter().map(PathBuf::from).collect();
    let mut dirs = vec![PathBuf::from("/run/current-system/sw/bin")];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".nix-profile/bin"));
        if let Some(user) = std::env::var_os("USER") {
            dirs.push(PathBuf::from("/etc/profiles/per-user").join(user).join("bin"));
        }
    }
    dirs.push(PathBuf::from("/usr/bin"));
    for dir in dirs {
        for bin in SYCOCA_BINS {
            candidates.push(dir.join(bin));
        }
    }
    candidates
}

fn refresh_sycoca() -> bool {
    for bin in sycoca_candidates() {
        let label = bin.display().to_string();
        match Command::new(&bin)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => {
                info!(bin = %label, "KDE service cache rebuilt");
                return true;
            }
            Ok(status) => {
                warn!(bin = %label, ?status, "KDE service cache rebuild failed");
                return false;
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                warn!(bin = %label, error = %err, "could not run KDE service cache rebuild");
                return false;
            }
        }
    }
    warn!(
        "kbuildsycoca6/kbuildsycoca5 not found on PATH or in the usual profiles; \
         KWin may not see the grant until its service cache is rebuilt. Install \
         kdePackages.kservice (NixOS: it is already on the packaged desktop's \
         PATH) or kservice (distro), or run kbuildsycoca6 manually, then relog."
    );
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

    #[test]
    fn entry_escapes_quotes_and_backslashes_in_wrapped_paths() {
        // A Nix wrapProgram script or a Windows-style copy can put quotes
        // and backslashes into the canonical /proc/self/exe path.
        let text = desktop_entry("/opt/My \"Overlay\"\\roxysu-overlay-rs");
        assert!(text.contains("Exec=\"/opt/My \\\"Overlay\\\"\\\\roxysu-overlay-rs\"\n"));
    }

    #[test]
    fn wrote_fresh_is_true_only_for_a_fresh_write() {
        use super::GrantOutcome;
        assert!(GrantOutcome::Wrote { refreshed: false }.wrote_fresh());
        assert!(GrantOutcome::Wrote { refreshed: true }.wrote_fresh());
        assert!(!GrantOutcome::Unchanged.wrote_fresh());
        assert!(!GrantOutcome::Failed.wrote_fresh());
        assert!(!GrantOutcome::NotAttempted.wrote_fresh());
    }
}
