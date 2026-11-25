import type { ApiErrorBody, Summary } from "./types";

/**
 * Where the local service lives.
 * - `npm run dev`: "/api", proxied by Vite to http://localhost:5055.
 * - Production build: http://localhost:5055 (override with VITE_API_BASE).
 */
export const API_BASE: string = (
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "/api" : "http://localhost:5055")
).replace(/\/$/, "");

export type ApiErrorKind = "network" | "not-found" | "http";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Fetched<T> {
  data: T;
  /** When the service saved the file (from Last-Modified), if known. */
  savedAt: Date | null;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<Fetched<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`Couldn't reach the service at ${API_BASE}.`, "network");
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiErrorBody>;
      if (body.error) message = body.error;
    } catch {
      /* body wasn't JSON */
    }
    throw new ApiError(message, res.status === 404 ? "not-found" : "http", res.status);
  }

  const lastModified = res.headers.get("Last-Modified");
  const savedAt = lastModified ? new Date(lastModified) : null;
  return {
    data: (await res.json()) as T,
    savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt : null,
  };
}

/** The saved `summary` dataset. Reads the service's file; does not call Empower. */
export function getSummary(signal?: AbortSignal): Promise<Fetched<Summary>> {
  return getJson<Summary>("/data/summary", signal);
}
