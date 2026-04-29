type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __ffTransientCache: Map<string, CacheEntry<unknown>> | undefined;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

function getCache(): Map<string, CacheEntry<unknown>> {
  if (!global.__ffTransientCache) {
    global.__ffTransientCache = new Map();
  }

  return global.__ffTransientCache;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function transientCacheKey(scope: string, payload: unknown): string {
  return `${scope}:${stableStringify(payload)}`;
}

export function getTransientCache<T>(key: string): T | null {
  const cache = getCache();
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setTransientCache<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  const cache = getCache();

  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (firstKey) cache.delete(firstKey);
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}
