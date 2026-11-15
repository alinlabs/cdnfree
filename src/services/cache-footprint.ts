import {
  clearAllBulkSessions,
  getAllReferencedBulkInspectionIds,
  removeBulkInspectionSession,
} from './bulk-inspection-store.ts';
import { loadBookmarks } from './bookmark-service.ts';
import { HISTORY_STORAGE_KEY, type StorageLike } from './history-service.ts';
import {
  clearCachedInspections,
  getInspectionCacheBytes,
  removeCachedInspection,
  removeCachedInspectionsByUrl,
} from './inspection-cache.ts';
import { formatCleanUrl } from '../utils/clean-url.ts';
import { smartCacheDb, type SmartCacheEntry } from './smart-cache-db.ts';
import { cancelVideoHydration } from './smart-cache-hydrator.ts';
import { deleteSmartCacheArtifacts } from './smart-cache-storage.ts';
import {
  getCanonicalVideoKey,
  normalizeCanonicalVideoUrl,
  videoPlaybackStore,
} from './video-playback-store.ts';
import {
  clearUrSessionCache,
  removeUrSessionCache,
} from '../pages/hasil-pencarian/shared/ur-session-cache.ts';
import type { MediaBookmark } from '../types/bookmark.ts';
import type { HistoryEntry } from '../types/history.ts';

export const CACHE_FOOTPRINT_CHANGED_EVENT = 'cdnfree:cache-footprint-changed';

export const HISTORY_CACHE_LOCAL_KEYS = [
  HISTORY_STORAGE_KEY,
  'cdnfree:inspection-url-index:v1',
  'cdnfree:bulk-sessions:v1',
] as const;

export const HISTORY_CACHE_SESSION_KEYS = [
  'cdnfree:bulk-sessions',
  'cdnfree:inspection-ur-map',
] as const;

export const MARKAH_CACHE_LOCAL_KEYS = ['cdnfree:bookmarks:v1'] as const;

export interface CacheFootprintSummary {
  historyBytes: number;
  markahBytes: number;
  totalBytes: number;
}

export function emitCacheFootprintChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CACHE_FOOTPRINT_CHANGED_EVENT));
  }
}

export function getUtf8ByteLength(text: string): number {
  if (!text) return 0;
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).byteLength
    : text.length;
}

export function measureStorageKeysBytes(
  storage: Pick<StorageLike, 'getItem'> | null | undefined,
  keys: readonly string[],
): number {
  if (!storage) return 0;
  let total = 0;
  for (const key of keys) {
    try {
      const value = storage.getItem(key);
      if (typeof value === 'string' && value.length > 0) {
        total += getUtf8ByteLength(value);
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return total;
}

export type FooterCacheMode = 'riwayat' | 'markah' | null;

export function resolveFooterCacheMode(pathname: string): FooterCacheMode {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/riwayat-pencarian') return 'riwayat';
  if (normalized === '/markah') return 'markah';
  return null;
}

export function collectBookmarkSmartCacheKeys(
  bookmarks: readonly Pick<MediaBookmark, 'url' | 'hlsUrl' | 'smartCacheKey'>[],
): Set<string> {
  const keys = new Set<string>();
  for (const bookmark of bookmarks) {
    if (bookmark.smartCacheKey) {
      keys.add(bookmark.smartCacheKey);
    }
    if (bookmark.url) {
      keys.add(getCanonicalVideoKey(bookmark.url));
    }
    if (bookmark.hlsUrl) {
      keys.add(getCanonicalVideoKey(bookmark.hlsUrl));
    }
  }
  return keys;
}

export function computeBookmarkMediaCacheBytes(
  bookmarks: readonly Pick<MediaBookmark, 'url' | 'hlsUrl' | 'smartCacheKey'>[],
  smartCacheEntries: readonly SmartCacheEntry[],
  getPosterBytes: (key: string) => number = () => 0,
): number {
  const keys = collectBookmarkSmartCacheKeys(bookmarks);
  if (keys.size === 0) return 0;

  let total = 0;
  const seenKeys = new Set<string>();
  for (const entry of smartCacheEntries) {
    if (!keys.has(entry.key) || seenKeys.has(entry.key)) continue;
    seenKeys.add(entry.key);
    total += entry.status === 'complete' ? entry.totalBytes : entry.hydratedBytes;
    total += getPosterBytes(entry.key);
  }
  for (const key of keys) {
    if (!seenKeys.has(key)) {
      total += getPosterBytes(key);
    }
  }
  return total;
}

export async function measureCacheFootprint(): Promise<CacheFootprintSummary> {
  const localStorageRef =
    typeof window !== 'undefined' ? window.localStorage : null;
  const sessionStorageRef =
    typeof window !== 'undefined' ? window.sessionStorage : null;

  await smartCacheDb.init();
  const [inspectionIdbBytes] = await Promise.all([getInspectionCacheBytes()]);

  const historyBytes =
    measureStorageKeysBytes(localStorageRef, HISTORY_CACHE_LOCAL_KEYS) +
    measureStorageKeysBytes(sessionStorageRef, HISTORY_CACHE_SESSION_KEYS) +
    inspectionIdbBytes;

  const bookmarks = loadBookmarks(localStorageRef).bookmarks;
  const markahStorageBytes = measureStorageKeysBytes(
    localStorageRef,
    MARKAH_CACHE_LOCAL_KEYS,
  );
  const markahMediaBytes = computeBookmarkMediaCacheBytes(
    bookmarks,
    smartCacheDb.listEntriesSync(),
    (key) => smartCacheDb.getPosterBytesSync(key),
  );

  const markahBytes = markahStorageBytes + markahMediaBytes;
  return {
    historyBytes,
    markahBytes,
    totalBytes: historyBytes + markahBytes,
  };
}

export async function markBookmarkInSmartCache(
  bookmark: Pick<MediaBookmark, 'url' | 'hlsUrl' | 'smartCacheKey'>,
): Promise<void> {
  await smartCacheDb.init();
  const keys = collectBookmarkSmartCacheKeys([bookmark]);
  await Promise.all(
    Array.from(keys).map((key) => smartCacheDb.setBookmarkedFlag(key, true)),
  );
  emitCacheFootprintChanged();
}

export async function purgeBookmarkMediaCache(
  removedBookmarks: readonly Pick<
    MediaBookmark,
    'url' | 'hlsUrl' | 'smartCacheKey'
  >[],
): Promise<void> {
  if (removedBookmarks.length === 0) {
    emitCacheFootprintChanged();
    return;
  }

  await smartCacheDb.init();
  for (const bookmark of removedBookmarks) {
    if (bookmark.url) {
      videoPlaybackStore.removeSnapshot(bookmark.url, { suppressUnmountMs: 1500 });
      const canonical = normalizeCanonicalVideoUrl(bookmark.url);
      if (canonical) {
        videoPlaybackStore.removeSnapshot(canonical, { suppressUnmountMs: 1500 });
      }
    }
    if (bookmark.hlsUrl) {
      videoPlaybackStore.removeSnapshot(bookmark.hlsUrl, { suppressUnmountMs: 1500 });
      const canonicalHls = normalizeCanonicalVideoUrl(bookmark.hlsUrl);
      if (canonicalHls) {
        videoPlaybackStore.removeSnapshot(canonicalHls, { suppressUnmountMs: 1500 });
      }
    }
  }

  const keys = collectBookmarkSmartCacheKeys(removedBookmarks);
  await Promise.all(
    Array.from(keys).map(async (key) => {
      cancelVideoHydration(key);
      videoPlaybackStore.removeSnapshot(key, { suppressUnmountMs: 1500 });
      await deleteSmartCacheArtifacts(key);
    }),
  );
  emitCacheFootprintChanged();
}

export async function purgeHistoryEntryCaches(
  removedEntries: readonly Pick<HistoryEntry, 'id' | 'url' | 'searchMode'>[],
  remainingEntries: readonly Pick<HistoryEntry, 'id' | 'url' | 'searchMode'>[],
): Promise<void> {
  if (removedEntries.length === 0) {
    emitCacheFootprintChanged();
    return;
  }

  const remainingEntryIds = new Set(remainingEntries.map((item) => item.id));
  const remainingSingleCleanUrls = new Set(
    remainingEntries
      .filter((item) => item.searchMode !== 'bulk')
      .map((item) => formatCleanUrl(item.url))
      .filter(Boolean),
  );
  const candidateIds = new Set<string>();
  const singleUrlsToPurge = new Set<string>();

  for (const entry of removedEntries) {
    candidateIds.add(entry.id);
    for (const siteId of removeBulkInspectionSession(entry.id)) {
      candidateIds.add(siteId);
    }
    if (entry.searchMode !== 'bulk') {
      const cleanUrl = formatCleanUrl(entry.url);
      if (cleanUrl && !remainingSingleCleanUrls.has(cleanUrl)) {
        singleUrlsToPurge.add(entry.url);
        removeUrSessionCache({ id: entry.id, url: entry.url });
      } else {
        removeUrSessionCache({ id: entry.id });
      }
    }
  }

  const remainingBulkIds = getAllReferencedBulkInspectionIds();
  const protectedIds = new Set<string>([
    ...remainingEntryIds,
    ...remainingBulkIds,
  ]);
  const idsToDelete = Array.from(candidateIds).filter(
    (id) => !protectedIds.has(id),
  );

  for (const id of idsToDelete) {
    removeUrSessionCache({ id });
  }

  await Promise.all([
    ...idsToDelete.map((id) => removeCachedInspection(id)),
    ...Array.from(singleUrlsToPurge).map((url) =>
      removeCachedInspectionsByUrl(url, protectedIds),
    ),
  ]);
  emitCacheFootprintChanged();
}

export async function purgeAllHistoryCaches(): Promise<void> {
  clearAllBulkSessions();
  clearUrSessionCache();
  await clearCachedInspections();
  emitCacheFootprintChanged();
}
