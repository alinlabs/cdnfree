import type { HeaderMode } from '../config/limits.ts';

export interface HostHeaderProfile {
  mode: HeaderMode;
  referer: string | null;
  origin: string | null;
  failures: number;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000;
const store = new Map<string, HostHeaderProfile>();

export function getProfile(host: string): HostHeaderProfile | undefined {
  const key = host.toLowerCase();
  const profile = store.get(key);
  if (!profile) return undefined;
  if (profile.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return profile;
}

export function recordSuccess(
  host: string,
  mode: HeaderMode,
  referer: string | null,
  origin: string | null,
): void {
  const key = host.toLowerCase();
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    const oldest = store.keys().next().value;
    if (typeof oldest === 'string') store.delete(oldest);
  }
  store.set(key, {
    mode,
    referer,
    origin,
    failures: 0,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function recordFailure(host: string): void {
  const key = host.toLowerCase();
  const profile = store.get(key);
  if (!profile) return;
  profile.failures += 1;
  if (profile.failures >= 3) {
    store.delete(key);
  }
}

export function reset(): void {
  store.clear();
}
