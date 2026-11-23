"use strict";

/**
 * Environment for the In-game overlay host.
 *
 * The Nix wrapper puts libstdc++ / icu / openssl on LD_LIBRARY_PATH so Node
 * children load the right libs. WebKitGTK must not inherit that path ahead of
 * its own RUNPATH. When the shell is a packaged resources tree
 * (`ROXYSU_RESOURCES`), drop LD_LIBRARY_PATH unless
 * `ROXYSU_OVERLAY_LIBRARY_PATH` names the path the host should see.
 *
 * Does not mutate `env`.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function overlayEnv(env) {
  const next = { ...env };
  const override =
    typeof next.ROXYSU_OVERLAY_LIBRARY_PATH === "string"
      ? next.ROXYSU_OVERLAY_LIBRARY_PATH.trim()
      : "";
  if (override) {
    next.LD_LIBRARY_PATH = override;
    return next;
  }
  if (typeof next.ROXYSU_RESOURCES === "string" && next.ROXYSU_RESOURCES.trim()) {
    delete next.LD_LIBRARY_PATH;
  }
  return next;
}

module.exports = { overlayEnv };
