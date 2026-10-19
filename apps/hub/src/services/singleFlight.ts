/**
 * Keyed single-flight: concurrent `run(key, fn)` calls with the same key share
 * one in-flight promise (success or failure, so errors reach every waiter). The
 * entry is removed in `finally`, so the next call after settlement starts a
 * fresh run. Different keys run independently.
 */
export function createKeyedFlights<K, T>() {
  const inFlight = new Map<K, Promise<T>>();
  return {
    run(key: K, fn: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;
      // `async` turns a synchronous throw from `fn` into a rejection. The entry is
      // registered before the first settlement callback can run, so the
      // cleanup below always runs after `set`.
      const promise: Promise<T> = (async () => fn())();
      inFlight.set(key, promise);
      const clear = () => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      };
      promise.then(clear, clear);
      return promise;
    },
    /** Whether a run for `key` is currently in flight. */
    has: (key: K) => inFlight.has(key),
    /** Number of keys currently in flight. */
    size: () => inFlight.size,
  };
}

/** Wrap `fn(key)` so overlapping calls with the same key share one run. */
export function createSingleFlight<K, T>(fn: (key: K) => Promise<T>) {
  const flights = createKeyedFlights<K, T>();
  const call = (key: K): Promise<T> => flights.run(key, () => fn(key));
  call.has = flights.has;
  call.size = flights.size;
  return call;
}
