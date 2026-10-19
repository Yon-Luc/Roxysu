import { describe, expect, test } from "bun:test";
import {
  createKeyedFlights,
  createSingleFlight,
} from "./singleFlight";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlight (search-index refresh, F-026)", () => {
  test("concurrent calls for the same id run one crawl", async () => {
    const gate = deferred();
    let runs = 0;
    const refresh = createSingleFlight(async (_id: number) => {
      runs += 1;
      await gate.promise;
    });

    const a = refresh(7);
    const b = refresh(7);
    const c = refresh(7);
    expect(refresh.has(7)).toBe(true);
    expect(refresh.size()).toBe(1);

    gate.resolve();
    await Promise.all([a, b, c]);
    expect(runs).toBe(1);
    expect(refresh.size()).toBe(0);
  });

  test("different ids run independently", async () => {
    const gates = new Map<number, ReturnType<typeof deferred>>([
      [1, deferred()],
      [2, deferred()],
    ]);
    const started: number[] = [];
    const refresh = createSingleFlight(async (id: number) => {
      started.push(id);
      await gates.get(id)!.promise;
    });

    const a = refresh(1);
    const b = refresh(2);
    expect(started).toEqual([1, 2]);
    expect(refresh.size()).toBe(2);

    gates.get(1)!.resolve();
    await a;
    expect(refresh.has(1)).toBe(false);
    expect(refresh.has(2)).toBe(true);

    gates.get(2)!.resolve();
    await b;
    expect(refresh.size()).toBe(0);
  });

  test("a failure reaches every waiter and clears the entry", async () => {
    const gate = deferred();
    let runs = 0;
    const refresh = createSingleFlight(async (_id: number) => {
      runs += 1;
      await gate.promise;
    });

    const a = refresh(3).then(
      () => "ok",
      (err: Error) => err.message,
    );
    const b = refresh(3).then(
      () => "ok",
      (err: Error) => err.message,
    );
    gate.reject(new Error("crawl failed"));
    expect(await a).toBe("crawl failed");
    expect(await b).toBe("crawl failed");
    expect(runs).toBe(1);
    expect(refresh.size()).toBe(0);

    // A later call starts a fresh run.
    const retry = createSingleFlight(async (_id: number) => "again");
    expect(await retry(3)).toBe("again");
  });

  test("a call after settlement starts a new run", async () => {
    let runs = 0;
    const refresh = createSingleFlight(async (_id: number) => {
      runs += 1;
    });
    await refresh(5);
    await refresh(5);
    expect(runs).toBe(2);
  });

  test("synchronous throw in the runner is a rejection and clears the entry", async () => {
    const refresh = createSingleFlight((_id: number): Promise<void> => {
      throw new Error("boom");
    });
    await expect(refresh(9)).rejects.toThrow("boom");
    expect(refresh.size()).toBe(0);
  });
});

describe("createKeyedFlights (ranked-best pull, F-024)", () => {
  test("parallel pulls for the same player and ruleset share one crawl", async () => {
    const gate = deferred();
    let crawls = 0;
    const flights = createKeyedFlights<string, number>();
    const crawl = async () => {
      crawls += 1;
      await gate.promise;
      return 42;
    };

    const first = flights.run("123:mania", crawl);
    const second = flights.run("123:mania", crawl);
    expect(second).toBe(first);
    gate.resolve();
    expect(await first).toBe(42);
    expect(await second).toBe(42);
    expect(crawls).toBe(1);
    expect(flights.size()).toBe(0);
  });

  test("another ruleset or player is not coalesced", async () => {
    let crawls = 0;
    const flights = createKeyedFlights<string, number>();
    const crawl = async () => {
      crawls += 1;
      return crawls;
    };
    await Promise.all([
      flights.run("123:mania", crawl),
      flights.run("123:osu", crawl),
      flights.run("456:mania", crawl),
    ]);
    expect(crawls).toBe(3);
  });

  test("failure clears the entry so the next pull can retry", async () => {
    const flights = createKeyedFlights<string, number>();
    await expect(
      flights.run("123:mania", async () => {
        throw new Error("osu! rate limit");
      }),
    ).rejects.toThrow("osu! rate limit");
    expect(flights.has("123:mania")).toBe(false);
    expect(await flights.run("123:mania", async () => 1)).toBe(1);
  });
});
