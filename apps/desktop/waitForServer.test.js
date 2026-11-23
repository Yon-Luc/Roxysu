import { describe, expect, test } from "bun:test";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isOwnHealthPayload, waitForServer } = require("./waitForServer.js");

/**
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void} onRequest
 */
function listen(onRequest) {
  const server = http.createServer(onRequest);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        throw new Error("test server missing port");
      }
      resolve({ server, port: address.port });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve(undefined)));
  });
}

const fast = { probeTimeoutMs: 40, retryDelayMs: 15, maxBodyBytes: 64 };

describe("waitForServer", () => {
  test("resolves on HTTP 200 { ok: true, service: 'roxysu-server' }", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "roxysu-server" }));
    });
    try {
      await waitForServer(port, "127.0.0.1", 500, fast);
    } finally {
      await close(server);
    }
  });

  test("does not accept { ok: true } without the service marker", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    try {
      await expect(waitForServer(port, "127.0.0.1", 80, fast)).rejects.toThrow(
        /Timed out/,
      );
    } finally {
      await close(server);
    }
  });

  test("does not accept a different service marker", async () => {
    let probes = 0;
    const { server, port } = await listen((_req, res) => {
      probes += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "some-other-server" }));
    });
    try {
      await expect(waitForServer(port, "127.0.0.1", 120, fast)).rejects.toThrow(
        /Timed out/,
      );
      // Kept polling instead of accepting the first 200.
      expect(probes).toBeGreaterThan(1);
    } finally {
      await close(server);
    }
  });

  test("does not accept { ok: false, service: 'roxysu-server' }", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, service: "roxysu-server" }));
    });
    try {
      await expect(waitForServer(port, "127.0.0.1", 80, fast)).rejects.toThrow(
        /Timed out/,
      );
    } finally {
      await close(server);
    }
  });

  test("does not accept a 200 that is not our health payload", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not roxysu</html>");
    });
    try {
      await expect(waitForServer(port, "127.0.0.1", 80, fast)).rejects.toThrow(
        /Timed out/,
      );
    } finally {
      await close(server);
    }
  });

  test("does not accept a 404", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(404);
      res.end("nope");
    });
    try {
      await expect(waitForServer(port, "127.0.0.1", 80, fast)).rejects.toThrow(
        /Timed out/,
      );
    } finally {
      await close(server);
    }
  });

  test("a hung socket retries one probe at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let total = 0;
    const { server, port } = await listen((_req, res) => {
      total += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      res.on("close", () => {
        inFlight -= 1;
      });
    });
    try {
      await expect(
        waitForServer(port, "127.0.0.1", 180, {
          probeTimeoutMs: 30,
          retryDelayMs: 10,
        }),
      ).rejects.toThrow(/Timed out/);
      expect(maxInFlight).toBe(1);
      expect(total).toBeGreaterThan(1);
      expect(total).toBeLessThan(12);
    } finally {
      await close(server);
    }
  });

  test("abort rejects and stops further probes", async () => {
    let total = 0;
    const { server, port } = await listen((_req, res) => {
      total += 1;
      res.writeHead(503);
      res.end("starting");
    });
    const controller = new AbortController();
    try {
      const pending = waitForServer(port, "127.0.0.1", 2_000, {
        ...fast,
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toThrow(/aborted/);
      const seen = total;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(total).toBe(seen);
    } finally {
      await close(server);
    }
  });

  test("DD-2: rejects another Roxysu server whose instance token differs", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "roxysu-server", instance: "stale", pid: 1 }));
    });
    try {
      await expect(
        waitForServer(port, "127.0.0.1", 80, { ...fast, expectInstance: "mine" }),
      ).rejects.toThrow(/Timed out/);
    } finally {
      await close(server);
    }
  });

  test("DD-2: accepts the server carrying this launch's instance token", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "roxysu-server", instance: "mine", pid: 1 }));
    });
    try {
      await waitForServer(port, "127.0.0.1", 500, { ...fast, expectInstance: "mine" });
    } finally {
      await close(server);
    }
  });
});

describe("isOwnHealthPayload", () => {
  test("older servers without an instance field are rejected when a token is expected", () => {
    expect(isOwnHealthPayload({ ok: true, service: "roxysu-server" }, "mine")).toBe(false);
    expect(isOwnHealthPayload({ ok: true, service: "roxysu-server" }, null)).toBe(true);
  });

  test("non-objects and wrong markers are rejected", () => {
    expect(isOwnHealthPayload(null, null)).toBe(false);
    expect(isOwnHealthPayload("ok", null)).toBe(false);
    expect(isOwnHealthPayload({ ok: true, service: "other", instance: "mine" }, "mine")).toBe(false);
  });
});
