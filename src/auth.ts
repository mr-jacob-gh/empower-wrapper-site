// The API key lives only in this browser (never in the code or the repo).
// "Remember" keeps it in localStorage; otherwise it lasts until the tab closes.

const STORAGE_KEY = "empower.apiKey";

/** Fallback when browser storage throws (e.g. some private modes). */
let memoryKey: string | null = null;

function read(store: () => Storage): string | null {
  try {
    return store().getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getApiKey(): string | null {
  return read(() => sessionStorage) ?? read(() => localStorage) ?? memoryKey;
}

export function setApiKey(key: string, remember: boolean): void {
  clearApiKey();
  try {
    (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, key.trim());
  } catch {
    memoryKey = key.trim(); // won't survive a reload
  }
}

export function clearApiKey(): void {
  memoryKey = null;
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      store().removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
