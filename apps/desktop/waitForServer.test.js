import { describe, expect, test } from "bun:test";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { healthzRetryDelayMs, isOwnHealthPayload, probePortOwner, waitForServer } = require("./waitForServer.js");

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

/**
 * @param {Promise<unknown>} pending
 */
async function rejectionOf(pending) {
  try {
    await pending;
  } catch (err) {
    return err;
  }
  throw new Error("expected rejection");
}

describe("healthzRetryDelayMs", () => {
  test("stays fast for the first 5s, then slows, unless overridden", () => {
    expect(healthzRetryDelayMs(0)).toBe(50);
    expect(healthzRetryDelayMs(4999)).toBe(50);
    expect(healthzRetryDelayMs(5000)).toBe(250);
    expect(healthzRetryDelayMs(10_000)).toBe(250);
    expect(healthzRetryDelayMs(10_000, 15)).toBe(15);
  });
});

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

  test("a monotonic clock jump trips the timeout without sleeping it out", async () => {
    const { server, port } = await listen(() => {});
    await close(server);
    const reads = [0, 1000];
    const now = () => {
      const next = reads.shift();
      if (next === undefined) throw new Error("now() called more than twice");
      return next;
    };
    const started = Date.now();
    const err = await rejectionOf(
      waitForServer(port, "127.0.0.1", 30, {
        now,
        waitId: "clock-1",
        probeTimeoutMs: 40,
      }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Timed out/);
    expect(err.waitId).toBe("clock-1");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(reads).toEqual([]);
  });

  test("abort rejection carries waitId", async () => {
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
        waitId: "abort-1",
      });
      controller.abort();
      const err = await rejectionOf(pending);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/aborted/);
      expect(err.waitId).toBe("abort-1");
      const seen = total;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(total).toBe(seen);
    } finally {
      await close(server);
    }
  });

  test("an already-aborted signal rejects with waitId and does not probe", async () => {
    const controller = new AbortController();
    controller.abort();
    let probes = 0;
    const { server, port } = await listen(() => {
      probes += 1;
    });
    try {
      const err = await rejectionOf(
        waitForServer(port, "127.0.0.1", 30, {
          signal: controller.signal,
          waitId: 42,
          retryDelayMs: 15,
          probeTimeoutMs: 20,
        }),
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/aborted/);
      expect(err.waitId).toBe(42);
      expect(probes).toBe(0);
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

describe("probePortOwner (DD-3)", () => {
  test("a Roxysu server from another launch reports its pid", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "roxysu-server", instance: "old", pid: 4242 }));
    });
    try {
      expect(await probePortOwner(port, "127.0.0.1", { expectInstance: "new" })).toEqual({ kind: "roxysu", pid: 4242 });
      expect(await probePortOwner(port, "127.0.0.1", { expectInstance: "old" })).toEqual({ kind: "self" });
    } finally {
      await close(server);
    }
  });

  test("any other HTTP answer is a foreign program", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(404);
      res.end("<h1>nope</h1>");
    });
    try {
      expect(await probePortOwner(port, "127.0.0.1")).toEqual({ kind: "other" });
    } finally {
      await close(server);
    }
  });

  test("nothing listening", async () => {
    const { server, port } = await listen(() => {});
    await close(server);
    expect(await probePortOwner(port, "127.0.0.1")).toEqual({ kind: "none" });
  });
});
