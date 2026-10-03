/**
 * Opt-in cache of rarely changing reference data (factions, role mappings) — PLAN §14.5.
 *
 * Off by default: the dashboard and the tests always read the database. The bot turns it on,
 * because every interaction resolves «who is this» from the same few tables. Another process (the
 * dashboard) changes that data, so entries live a few seconds; the job worker clears the cache
 * before every job, and code inside a transaction never goes through it.
 */
let ttlMs = 0;
const store = new Map<string, { value: unknown; at: number }>();

export function enableReadCache(milliseconds = 5_000) {
  ttlMs = milliseconds;
  store.clear();
}

export function isReadCacheEnabled(): boolean {
  return ttlMs > 0;
}

export function clearReadCache() {
  store.clear();
}

/** `load()` once per `ttl` while the cache is on; straight through while it is off. */
export async function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (ttlMs <= 0) return load();
  const entry = store.get(key);
  if (entry && Date.now() - entry.at < ttlMs) return entry.value as T;
  const value = await load();
  store.set(key, { value, at: Date.now() });
  return value;
}
