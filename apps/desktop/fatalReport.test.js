import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildFatalReport, tailLines } = require("./fatalReport.js");

describe("tailLines", () => {
  test("keeps the last non-empty lines", () => {
    const text = ["a", "", "b", "c", "d", ""].join("\n");
    expect(tailLines(text, 2)).toBe("c\nd");
  });

  test("handles CRLF and non-strings", () => {
    expect(tailLines("x\r\ny\r\n", 5)).toBe("x\ny");
    expect(tailLines(/** @type {any} */ (null))).toBe("");
  });
});

describe("buildFatalReport (DD-3)", () => {
  test("port in use names the port and an older Roxysu server's pid", () => {
    const r = buildFatalReport({
      reason: "port-in-use",
      port: 4321,
      portOwner: { kind: "roxysu", pid: 4242 },
      logTail: "boot\nport 4321 is already in use (ROXYSU_PORT)\n",
      logsDir: "/data/logs",
    });
    expect(r.message).toContain("port 4321 is already in use");
    expect(r.detail).toContain("pid 4242");
    expect(r.detail).toContain("Last server log lines:\nboot\nport 4321 is already in use");
    expect(r.detail).toContain("Logs: /data/logs");
  });

  test("a foreign program on the port is called out", () => {
    const r = buildFatalReport({ reason: "health-timeout", port: 4321, portOwner: { kind: "other" } });
    expect(r.detail).toContain("Another program is answering on port 4321");
  });

  test("every reason has its own message", () => {
    const reasons = ["port-in-use", "respawn-exhausted", "health-timeout", "load-failed", "ui-missing", "renderer-crash-loop"];
    const messages = new Set(reasons.map((reason) => buildFatalReport({ reason, port: 1 }).message));
    expect(messages.size).toBe(reasons.length);
  });

  test("no empty sections", () => {
    const r = buildFatalReport({ reason: "load-failed", port: 4321 });
    expect(r.detail).toBe("");
  });
});
