import {
  smartCacheDb,
  type SmartCacheBackend,
  type SmartCacheEntry,
} from './smart-cache-db.ts';
import {
  buildSmartCacheHlsUrl,
  buildSmartCacheMediaUrl,
} from '../utils/video-source-strategy.ts';

export const SMARTCACHE_MEDIA_CACHE_NAME = 'cdnfree-smartcache-media-v1';
export const SMARTCACHE_OPFS_DIR = 'smartcache';
export const MAX_SINGLE_CACHE_BYTES = 512 * 1024 * 1024; // 512 MiB
export const DEFAULT_VIDEO_CACHE_LIMIT_MB = 1536; // 1.5 GiB
export const MAX_TOTAL_CACHE_BYTES = DEFAULT_VIDEO_CACHE_LIMIT_MB * 1024 * 1024;

export interface SmartCacheStats {
  totalEntries: number;
  completeEntries: number;
  hydratingEntries: number;
  totalBytes: number;
  budgetBytes: number;
}

const blobUrlMemo = new Map<string, string>();
let persistRequested = false;

export async function requestSmartCachePersistence(): Promise<void> {
  if (persistRequested || typeof navigator === 'undefined') return;
  persistRequested = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Silent fallback
  }
}

export async function isOpfsSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return false;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(SMARTCACHE_OPFS_DIR, { create: true });
    return Boolean(dir);
  } catch {
    return false;
  }
}

export function isCacheApiSupported(): boolean {
  return typeof caches !== 'undefined';
}

export function readConfiguredVideoCacheLimitMb(): number {
  if (typeof window === 'undefined') return DEFAULT_VIDEO_CACHE_LIMIT_MB;
  try {
    const raw = window.localStorage.getItem('cdnfree:settings:v1');
    if (!raw) return DEFAULT_VIDEO_CACHE_LIMIT_MB;
    const parsed = JSON.parse(raw) as { privacy?: { videoCacheLimitMb?: unknown } };
    const limit = parsed?.privacy?.videoCacheLimitMb;
    if (
      limit === 256 ||
      limit === 512 ||
      limit === 1024 ||
      limit === 1536 ||
      limit === 2048
    ) {
      return limit;
    }
  } catch {
    // Ignore storage/parse failure
  }
  return DEFAULT_VIDEO_CACHE_LIMIT_MB;
}

export function resolveSmartCacheBudgetBytes(
  limitMb: number,
  estimatedQuotaBytes?: number | null,
): number {
  const configuredBytes = Math.max(64, Math.floor(limitMb)) * 1024 * 1024;
  if (typeof estimatedQuotaBytes === 'number' && estimatedQuotaBytes > 0) {
    return Math.min(configuredBytes, Math.floor(estimatedQuotaBytes * 0.5));
  }
  return configuredBytes;
}

export async function estimateSmartCacheBudgetBytes(): Promise<number> {
  const limitMb = readConfiguredVideoCacheLimitMb();
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return resolveSmartCacheBudgetBytes(limitMb, null);
  }
  try {
    const est = await navigator.storage.estimate();
    return resolveSmartCacheBudgetBytes(limitMb, est.quota);
  } catch {
    // Ignore estimate failure
  }
  return resolveSmartCacheBudgetBytes(limitMb, null);
}

async function getOpfsCacheDir(create = true): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(SMARTCACHE_OPFS_DIR, { create });
  } catch {
    return null;
  }
}

export async function writeStreamToOpfs(
  key: string,
  stream: ReadableStream<Uint8Array>,
  onProgress: (writtenBytes: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const dir = await getOpfsCacheDir(true);
  if (!dir) return { ok: false, error: 'OPFS tidak tersedia.' };

  const filename = `${key}.bin`;
  let writable: FileSystemWritableFileStream | null = null;
  const reader = stream.getReader();
  let written = 0;

  try {
    const handle = await dir.getFileHandle(filename, { create: true });
    writable = await handle.createWritable();

    while (true) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        written += value.byteLength;
        if (written > MAX_SINGLE_CACHE_BYTES) {
          throw new Error('exceeds-max-single-file');
        }
        await writable.write(value as unknown as BufferSource);
        onProgress(written);
      }
    }

    await writable.close();
    writable = null;
    return { ok: true, bytes: written };
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // Ignore
    }
    if (writable) {
      try {
        await writable.abort();
      } catch {
        // Ignore
      }
    }
    await deleteOpfsFile(key);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menulis berkas OPFS.',
    };
  }
}

export async function readOpfsFile(key: string): Promise<File | null> {
  const dir = await getOpfsCacheDir(false);
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(`${key}.bin`, { create: false });
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteOpfsFile(key: string): Promise<void> {
  const dir = await getOpfsCacheDir(false);
  if (!dir) return;
  try {
    await dir.removeEntry(`${key}.bin`);
  } catch {
    // Ignore missing file
  }
}

export async function writeBufferToCacheApi(
  virtualUrl: string,
  body: Blob | ArrayBuffer | Uint8Array | string,
  mimeType: string,
): Promise<boolean> {
  if (!isCacheApiSupported()) return false;
  try {
    const cache = await caches.open(SMARTCACHE_MEDIA_CACHE_NAME);
    const headers = new Headers({
      'Content-Type': mimeType || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'X-CDNFREE-Cache': 'HIT',
    });
    const res = new Response(body as BodyInit, { status: 200, headers });
    await cache.put(virtualUrl, res);
    return true;
  } catch {
    return false;
  }
}

export async function hasCacheApiEntry(virtualUrl: string): Promise<boolean> {
  if (!isCacheApiSupported()) return false;
  try {
    const cache = await caches.open(SMARTCACHE_MEDIA_CACHE_NAME);
    const matched = await cache.match(virtualUrl);
    return Boolean(matched);
  } catch {
    return false;
  }
}

export async function deleteCacheApiByKeyPrefix(key: string): Promise<void> {
  if (!isCacheApiSupported()) return;
  try {
    const cache = await caches.open(SMARTCACHE_MEDIA_CACHE_NAME);
    const keys = await cache.keys();
    const mediaTarget = buildSmartCacheMediaUrl(key);
    const hlsPrefix = `/smartcache/v1/hls/${encodeURIComponent(key)}/`;
    await Promise.all(
      keys.map(async (req) => {
        const parsed = new URL(req.url);
        const pathWithQuery = `${parsed.pathname}${parsed.search}`;
        if (pathWithQuery === mediaTarget || parsed.pathname.startsWith(hlsPrefix)) {
          await cache.delete(req);
        }
      }),
    );
  } catch {
    // Ignore
  }
}

export async function deleteSmartCacheArtifacts(key: string): Promise<void> {
  const memo = blobUrlMemo.get(key);
  if (memo) {
    URL.revokeObjectURL(memo);
    blobUrlMemo.delete(key);
  }
  await Promise.all([
    deleteOpfsFile(key),
    deleteCacheApiByKeyPrefix(key),
    smartCacheDb.deleteEntry(key),
  ]);
}

export async function evictSmartCacheIfNeeded(
  incomingBytes: number,
  protectedKeys: Set<string> = new Set(),
): Promise<boolean> {
  const budget = await estimateSmartCacheBudgetBytes();
  if (incomingBytes > budget) return false;

  const completeEntries = smartCacheDb
    .listEntriesSync()
    .filter((entry) => entry.status === 'complete');
  let usedBytes = completeEntries.reduce((sum, item) => sum + item.totalBytes, 0);

  if (usedBytes + incomingBytes <= budget) return true;

  // Sort oldest accessed first; evict non-bookmarked before bookmarked
  const candidates = [...completeEntries].sort((a, b) => {
    const aProtected = protectedKeys.has(a.key) || Boolean(a.isBookmarked);
    const bProtected = protectedKeys.has(b.key) || Boolean(b.isBookmarked);
    if (aProtected !== bProtected) return aProtected ? 1 : -1;
    return a.lastAccessedAt - b.lastAccessedAt;
  });

  for (const item of candidates) {
    if (usedBytes + incomingBytes <= budget) break;
    await deleteSmartCacheArtifacts(item.key);
    usedBytes = Math.max(0, usedBytes - item.totalBytes);
  }

  return usedBytes + incomingBytes <= budget;
}

export async function enforceSmartCacheBudget(): Promise<void> {
  await smartCacheDb.init();
  await evictSmartCacheIfNeeded(0);
}

export async function clearAllSmartCache(): Promise<void> {
  for (const url of blobUrlMemo.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlMemo.clear();

  if (isCacheApiSupported()) {
    try {
      await caches.delete(SMARTCACHE_MEDIA_CACHE_NAME);
    } catch {
      // Ignore
    }
  }

  const dir = await getOpfsCacheDir(false);
  if (dir) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(SMARTCACHE_OPFS_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  }

  await smartCacheDb.clearAll();
}

export async function getSmartCacheStats(): Promise<SmartCacheStats> {
  await smartCacheDb.init();
  const all = smartCacheDb.listEntriesSync();
  const complete = all.filter((e) => e.status === 'complete');
  const hydrating = all.filter((e) => e.status === 'hydrating');
  const budgetBytes = await estimateSmartCacheBudgetBytes();
  return {
    totalEntries: all.length,
    completeEntries: complete.length,
    hydratingEntries: hydrating.length,
    totalBytes: complete.reduce((sum, e) => sum + e.totalBytes, 0),
    budgetBytes,
  };
}

export async function resolveCachedBlobPlaybackUrl(
  entry: SmartCacheEntry,
): Promise<string | null> {
  if (entry.status !== 'complete') return null;

  // When our root SW controls the page, virtual /smartcache/v1/... URLs support full 206 byte-range seeking
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    return entry.kind === 'hls'
      ? buildSmartCacheHlsUrl(entry.key)
      : buildSmartCacheMediaUrl(entry.key);
  }

  // Fallback on very first page load before SW claims client for progressive videos
  if (entry.kind === 'video') {
    const existing = blobUrlMemo.get(entry.key);
    if (existing) return existing;

    let blob: Blob | null = null;
    if (entry.storageBackend === 'opfs') {
      blob = await readOpfsFile(entry.key);
    } else if (isCacheApiSupported()) {
      const cache = await caches.open(SMARTCACHE_MEDIA_CACHE_NAME);
      const res = await cache.match(buildSmartCacheMediaUrl(entry.key));
      if (res) blob = await res.blob();
    }
    if (blob && blob.size > 0) {
      const objUrl = URL.createObjectURL(blob);
      blobUrlMemo.set(entry.key, objUrl);
      return objUrl;
    }
  }

  return null;
}

export async function pickPreferredStorageBackend(): Promise<SmartCacheBackend | null> {
  if (await isOpfsSupported()) return 'opfs';
  if (isCacheApiSupported()) return 'cache-api';
  return null;
}
