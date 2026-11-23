"use strict";

const http = require("node:http");

const HEALTHZ_FAST_DELAY_MS = 50;
const HEALTHZ_SLOW_DELAY_MS = 250;
const HEALTHZ_FAST_WINDOW_MS = 5_000;

/**
 * @param {number} elapsedMs monotonic elapsed time
 * @param {number} [override] explicit retryDelayMs from options
 */
function healthzRetryDelayMs(elapsedMs, override) {
  if (typeof override === "number") return override;
  return elapsedMs < HEALTHZ_FAST_WINDOW_MS ? HEALTHZ_FAST_DELAY_MS : HEALTHZ_SLOW_DELAY_MS;
}

/**
 * @param {unknown} body Parsed healthz JSON.
 * @param {string | null} expectInstance
 */
function isOwnHealthPayload(body, expectInstance) {
  if (!body || typeof body !== "object") return false;
  const b = /** @type {{ ok?: unknown, service?: unknown, instance?: unknown }} */ (body);
  if (b.ok !== true || b.service !== "roxysu-server") return false;
  return expectInstance == null || b.instance === expectInstance;
}

/**
 * Poll `/api/system/healthz` until it returns HTTP 200 with JSON
 * `{ ok: true, service: "roxysu-server" }`. The `service` marker (desktop M4)
 * makes sure the port belongs to our server: anything else listening there —
 * an older/stray build, another product, a stub page — must not satisfy the
 * wait and strand the window on a stranger's UI.
 * `expectInstance` (DD-2): when set, the payload must also carry that exact
 * per-launch `instance` token, which the shell passed to its own child in
 * ROXYSU_INSTANCE_TOKEN. Another Roxysu server on the port — an orphan from a
 * crashed session, a dev server — is then rejected instead of adopted.
 * One in-flight probe at a time. Destroying a timed-out request emits `error`;
 * that path must not schedule a second retry. `signal` aborts the wait.
 * The deadline uses a monotonic clock (`options.now`, default `performance.now`)
 * so a suspend or NTP step cannot trip it (DD-25). Retries are 50 ms for the
 * first 5 s of elapsed monotonic time, then 250 ms, unless `retryDelayMs` is
 * set (DD-13). Rejection errors carry `waitId`.
 *
 * @param {number} port
 * @param {string} host
 * @param {number} [timeoutMs]
 * @param {{ signal?: AbortSignal, expectInstance?: string | null, probeTimeoutMs?: number, retryDelayMs?: number, maxBodyBytes?: number, now?: () => number, waitId?: string | number | null }} [options]
 * @returns {Promise<void>}
 */
function waitForServer(port, host, timeoutMs = 180_000, options = {}) {
  const healthPath = "/api/system/healthz";
  const probeTimeoutMs = options.probeTimeoutMs ?? 1500;
  const maxBodyBytes = options.maxBodyBytes ?? 4096;
  const signal = options.signal;
  const expectInstance = options.expectInstance ?? null;
  const now = options.now ?? (() => performance.now());
  const waitId = options.waitId ?? null;
  const started = now();

  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    /** @type {import("node:http").ClientRequest | null} */
    let req = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (req) {
        req.destroy();
        req = null;
      }
      if (signal) signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(undefined);
    };

    const rejection = (message) => {
      const err = new Error(message);
      err.waitId = waitId;
      return err;
    };

    const onAbort = () => {
      finish(rejection("waitForServer aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        finish(rejection("waitForServer aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const retry = () => {
      if (settled) return;
      const elapsed = now() - started;
      if (elapsed > timeoutMs) {
        finish(
          rejection(
            `Timed out waiting for Roxysu at http://${host}:${port}${healthPath}`,
          ),
        );
        return;
      }
      timer = setTimeout(tryOnce, healthzRetryDelayMs(elapsed, options.retryDelayMs));
    };

    const tryOnce = () => {
      if (settled) return;
      let attemptDone = false;
      const failOnce = () => {
        if (settled || attemptDone) return;
        attemptDone = true;
        retry();
      };

      req = http.get(
        { host, port, path: healthPath, timeout: probeTimeoutMs },
        (res) => {
          /** @type {Buffer[]} */
          const chunks = [];
          let total = 0;
          res.on("data", (chunk) => {
            total += chunk.length;
            if (total > maxBodyBytes) {
              failOnce();
              req?.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (settled || attemptDone) return;
            if (res.statusCode === 200) {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (isOwnHealthPayload(body, expectInstance)) {
                  attemptDone = true;
                  finish();
                  return;
                }
              } catch {
                // not our health payload
              }
            }
            failOnce();
          });
        },
      );
      req.on("error", failOnce);
      req.on("timeout", () => {
        req?.destroy();
      });
    };

    tryOnce();
  });
}

/**
 * One healthz probe to say who holds the port when our own server failed
 * (DD-3 dialog wording). Never throws.
 * @param {number} port
 * @param {string} host
 * @param {{ expectInstance?: string | null, timeoutMs?: number }} [options]
 * @returns {Promise<{ kind: "none" } | { kind: "roxysu", pid: number | null } | { kind: "other" } | { kind: "self" }>}
 */
function probePortOwner(port, host, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const req = http.get(
      { host, port, path: "/api/system/healthz", timeout: timeoutMs },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
          if (text.length > 4096) res.destroy();
        });
        res.on("close", () => {
          try {
            const body = JSON.parse(text);
            if (body && body.ok === true && body.service === "roxysu-server") {
              if (options.expectInstance != null && body.instance === options.expectInstance) {
                finish({ kind: "self" });
                return;
              }
              finish({ kind: "roxysu", pid: Number.isInteger(body.pid) ? body.pid : null });
              return;
            }
          } catch {
            // not a Roxysu payload
          }
          finish({ kind: "other" });
        });
      },
    );
    req.on("error", () => finish({ kind: "none" }));
    req.on("timeout", () => {
      req.destroy();
      finish({ kind: "other" });
    });
  });
}

module.exports = {
  HEALTHZ_FAST_DELAY_MS,
  HEALTHZ_FAST_WINDOW_MS,
  HEALTHZ_SLOW_DELAY_MS,
  healthzRetryDelayMs,
  isOwnHealthPayload,
  probePortOwner,
  waitForServer,
};
