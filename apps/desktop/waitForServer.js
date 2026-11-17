"use strict";

const http = require("node:http");

/**
 * Poll `/api/system/healthz` until it returns HTTP 200 and JSON `{ ok: true }`.
 * One in-flight probe at a time. Destroying a timed-out request emits `error`;
 * that path must not schedule a second retry. `signal` aborts the wait.
 *
 * @param {number} port
 * @param {string} host
 * @param {number} [timeoutMs]
 * @param {{ signal?: AbortSignal, probeTimeoutMs?: number, retryDelayMs?: number, maxBodyBytes?: number }} [options]
 * @returns {Promise<void>}
 */
function waitForServer(port, host, timeoutMs = 180_000, options = {}) {
  const healthPath = "/api/system/healthz";
  const probeTimeoutMs = options.probeTimeoutMs ?? 1500;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const maxBodyBytes = options.maxBodyBytes ?? 4096;
  const signal = options.signal;
  const started = Date.now();

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

    const onAbort = () => {
      finish(new Error("waitForServer aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        finish(new Error("waitForServer aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const retry = () => {
      if (settled) return;
      if (Date.now() - started > timeoutMs) {
        finish(
          new Error(
            `Timed out waiting for Roxysu at http://${host}:${port}${healthPath}`,
          ),
        );
        return;
      }
      timer = setTimeout(tryOnce, retryDelayMs);
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
                if (body && body.ok === true) {
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

module.exports = { waitForServer };
