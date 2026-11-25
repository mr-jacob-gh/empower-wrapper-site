// In-memory, per-tab cache for saved datasets. Nothing is written to browser
// storage, the repo or the service; clear() drops it (e.g. when the key is removed).

import type { Fetched } from "./api";

export interface Cached<T> {
  /** Reuses the last result if it's younger than the max age, unless `force`. */
  get(force?: boolean): Promise<Fetched<T>>;
  /** The last result, if any, without fetching. */
  peek(): Fetched<T> | null;
  clear(): void;
}

export function cached<T>(load: () => Promise<Fetched<T>>, maxAgeMs: number): Cached<T> {
  let value: Fetched<T> | null = null;
  let loadedAt = 0;
  let inFlight: Promise<Fetched<T>> | null = null;
  let generation = 0;

  return {
    get(force = false) {
      if (inFlight) return inFlight;
      if (!force && value && Date.now() - loadedAt < maxAgeMs) return Promise.resolve(value);
      const gen = generation;
      const p = load().then(
        (result) => {
          if (gen === generation) {
            value = result;
            loadedAt = Date.now();
            inFlight = null;
          }
          return result;
        },
        (err: unknown) => {
          if (gen === generation) inFlight = null;
          throw err;
        },
      );
      inFlight = p;
      return p;
    },
    peek: () => value,
    clear() {
      generation++;
      value = null;
      inFlight = null;
    },
  };
}
