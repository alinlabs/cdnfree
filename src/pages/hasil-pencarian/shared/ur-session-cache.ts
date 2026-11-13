import { formatCleanUrl } from '../../../utils/clean-url';

export interface CachedInspectionRef {
  id: string;
  canonicalUrl: string;
}

const SESSION_CACHE_KEY = 'cdnfree:inspection-ur-map';
const SESSION_CACHE_MAX_ENTRIES = 30;

function readUrSessionMap(): Record<string, CachedInspectionRef> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, CachedInspectionRef>)
      : {};
  } catch {
    return {};
  }
}

export function lookupUrSessionCache(cleanKey: string | null): CachedInspectionRef | null {
  if (!cleanKey) return null;
  const entry = readUrSessionMap()[cleanKey];
  if (!entry || typeof entry.id !== 'string' || typeof entry.canonicalUrl !== 'string') {
    return null;
  }
  return entry;
}

export function writeUrSessionCache(destinationUrl: string, id: string): void {
  if (typeof window === 'undefined') return;
  const cleanKey = formatCleanUrl(destinationUrl);
  if (!cleanKey) return;
  try {
    const map = readUrSessionMap();
    delete map[cleanKey];
    map[cleanKey] = { id, canonicalUrl: destinationUrl };
    const entries = Object.entries(map);
    const trimmed =
      entries.length > SESSION_CACHE_MAX_ENTRIES
        ? Object.fromEntries(entries.slice(-SESSION_CACHE_MAX_ENTRIES))
        : map;
    window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}
