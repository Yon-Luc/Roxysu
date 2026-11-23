"use strict";

/**
 * Text for the fatal-error dialog (DD-3). Pure, no Electron imports, so the
 * wording and the log-tail trimming are unit-tested.
 */

/** How many trailing server.log lines the dialog shows. */
const FATAL_LOG_TAIL_LINES = 8;
/** Never read more than this from the end of the log. */
const FATAL_LOG_TAIL_BYTES = 4096;

/**
 * Last `maxLines` non-empty lines of `text`.
 * @param {string} text
 * @param {number} [maxLines]
 */
function tailLines(text, maxLines = FATAL_LOG_TAIL_LINES) {
  if (typeof text !== "string" || !text) return "";
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-maxLines).join("\n");
}

/**
 * @typedef {"port-in-use" | "respawn-exhausted" | "health-timeout" | "load-failed" | "ui-missing" | "renderer-crash-loop"} FatalReason
 * @typedef {{ kind: "none" } | { kind: "roxysu", pid: number | null } | { kind: "other" }} PortOwner
 */

/**
 * @param {{ reason: FatalReason, port: number, logTail?: string, portOwner?: PortOwner | null, logsDir?: string, error?: string }} input
 * @returns {{ message: string, detail: string }}
 */
function buildFatalReport(input) {
  const { reason, port } = input;
  /** @type {string} */
  let message;
  /** @type {string[]} */
  const detail = [];
  switch (reason) {
    case "port-in-use":
      message = `Roxysu could not start: port ${port} is already in use.`;
      break;
    case "respawn-exhausted":
      message = "The Roxysu local server keeps stopping, so Roxysu has to close.";
      break;
    case "health-timeout":
      message = "The Roxysu local server did not start in time.";
      break;
    case "load-failed":
      message = "Roxysu could not open its window content.";
      break;
    case "ui-missing":
      message = "Roxysu's interface files are missing from this installation.";
      break;
    case "renderer-crash-loop":
      message = "The Roxysu window keeps crashing.";
      break;
    default:
      message = "Roxysu ran into an error and has to close.";
  }
  const owner = input.portOwner;
  if (owner && owner.kind === "roxysu") {
    detail.push(
      `Another Roxysu server${owner.pid ? ` (pid ${owner.pid})` : ""} is still running on port ${port} — ` +
        "probably left over from an earlier session or a development server. Stop it, then choose Retry.",
    );
  } else if (owner && owner.kind === "other") {
    detail.push(
      `Another program is answering on port ${port}. Close it, or start Roxysu with ROXYSU_PORT set to a free port.`,
    );
  } else if (reason === "port-in-use") {
    detail.push(`Something else is using port ${port}. Close it, then choose Retry.`);
  }
  if (input.error) detail.push(`Error: ${input.error}`);
  const tail = tailLines(input.logTail ?? "");
  if (tail) detail.push(`Last server log lines:\n${tail}`);
  if (input.logsDir) detail.push(`Logs: ${input.logsDir}`);
  return { message, detail: detail.join("\n\n") };
}

module.exports = {
  FATAL_LOG_TAIL_BYTES,
  FATAL_LOG_TAIL_LINES,
  buildFatalReport,
  tailLines,
};
