import type { ResourceRecord } from '../types/inspection.ts';
import { getAssetFilename } from '../utils/asset-explorer.ts';
import {
  buildSmartCacheHlsUrl,
  buildSmartCacheMediaUrl,
} from '../utils/video-source-strategy.ts';
import { smartCacheDb } from './smart-cache-db.ts';
import {
  isVodHlsPlaylist,
  parseHlsManifest,
  rewriteHlsPlaylistToLocal,
  selectOptimalHlsVariant,
} from './smart-cache-hls.ts';
import {
  deleteSmartCacheArtifacts,
  evictSmartCacheIfNeeded,
  hasCacheApiEntry,
  isCacheApiSupported,
  MAX_SINGLE_CACHE_BYTES,
  pickPreferredStorageBackend,
  requestSmartCachePersistence,
  SMARTCACHE_MEDIA_CACHE_NAME,
  writeBufferToCacheApi,
  writeStreamToOpfs,
} from './smart-cache-storage.ts';
import { getCanonicalVideoKey } from './video-playback-store.ts';

export interface HydrateVideoParams {
  resource: Pick<ResourceRecord, 'id' | 'url' | 'mimeType' | 'declaredBytes' | 'assetKind' | 'hlsUrl'>;
  fetchUrl: string;
  isHls: boolean;
  isBookmarked?: boolean;
  urlsToAlias?: string[];
}

const activeHydrations = new Map<string, AbortController>();

export function isHydratingVideo(key: string): boolean {
  return activeHydrations.has(key);
}

export function cancelVideoHydration(key: string): void {
  const controller = activeHydrations.get(key);
  if (controller) {
    controller.abort();
    activeHydrations.delete(key);
  }
}

async function hydrateProgressiveVideo(
  key: string,
  params: HydrateVideoParams,
  controller: AbortController,
): Promise<boolean> {
  const backend = await pickPreferredStorageBackend();
  if (!backend) return false;

  const filename = getAssetFilename(params.resource.url);
  const response = await fetch(params.fetchUrl, {
    method: 'GET',
    signal: controller.signal,
    credentials: 'same-origin',
  });

  if (!response.ok || response.status === 206 || !response.body) {
    return false;
  }

  const lenHeader = response.headers.get('content-length');
  const declaredLen =
    lenHeader && /^\d+$/.test(lenHeader.trim())
      ? Number(lenHeader.trim())
      : (params.resource.declaredBytes ?? 0);

  if (declaredLen > MAX_SINGLE_CACHE_BYTES) {
    return false;
  }

  if (declaredLen > 0) {
    const budgetOk = await evictSmartCacheIfNeeded(declaredLen, new Set([key]));
    if (!budgetOk) return false;
  }

  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim() ||
    params.resource.mimeType ||
    'video/mp4';

  const now = Date.now();
  await smartCacheDb.putEntry({
    key,
    canonicalUrl: params.resource.url,
    filename,
    kind: 'video',
    mimeType: contentType,
    totalBytes: declaredLen,
    hydratedBytes: 0,
    status: 'hydrating',
    storageBackend: backend,
    isBookmarked: params.isBookmarked,
    createdAt: now,
    lastAccessedAt: now,
  });

  let finalBytes = 0;

  if (backend === 'opfs') {
    let lastProgressAt = 0;
    const writeRes = await writeStreamToOpfs(
      key,
      response.body,
      (written) => {
        const ts = Date.now();
        if (ts - lastProgressAt > 750) {
          lastProgressAt = ts;
          void smartCacheDb.putEntry({
            key,
            canonicalUrl: params.resource.url,
            filename,
            kind: 'video',
            mimeType: contentType,
            totalBytes: declaredLen || written,
            hydratedBytes: written,
            status: 'hydrating',
            storageBackend: 'opfs',
            isBookmarked: params.isBookmarked,
            createdAt: now,
            lastAccessedAt: ts,
          });
        }
      },
      controller.signal,
    );

    if (!writeRes.ok || writeRes.bytes <= 0) {
      await deleteSmartCacheArtifacts(key);
      return false;
    }
    finalBytes = writeRes.bytes;
  } else {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_SINGLE_CACHE_BYTES) {
      await deleteSmartCacheArtifacts(key);
      return false;
    }
    const stored = await writeBufferToCacheApi(
      buildSmartCacheMediaUrl(key),
      buffer,
      contentType,
    );
    if (!stored) {
      await deleteSmartCacheArtifacts(key);
      return false;
    }
    finalBytes = buffer.byteLength;
  }

  if (controller.signal.aborted) {
    await deleteSmartCacheArtifacts(key);
    return false;
  }

  await smartCacheDb.mapUrlsToKey(
    [params.resource.url, params.fetchUrl, ...(params.urlsToAlias ?? [])],
    key,
  );

  await smartCacheDb.putEntry({
    key,
    canonicalUrl: params.resource.url,
    filename,
    kind: 'video',
    mimeType: contentType,
    totalBytes: finalBytes,
    hydratedBytes: finalBytes,
    status: 'complete',
    storageBackend: backend,
    isBookmarked: params.isBookmarked,
    createdAt: now,
    lastAccessedAt: Date.now(),
  });

  return true;
}

async function hydrateHlsVideo(
  key: string,
  params: HydrateVideoParams,
  controller: AbortController,
): Promise<boolean> {
  if (!isCacheApiSupported()) return false;
  const filename = getAssetFilename(params.resource.url);

  let manifestUrl = params.fetchUrl;
  let manifestRes = await fetch(manifestUrl, {
    method: 'GET',
    signal: controller.signal,
    credentials: 'same-origin',
  });
  if (!manifestRes.ok) return false;
  let manifestText = await manifestRes.text();

  const parsedRoot = parseHlsManifest(manifestText, manifestUrl);
  if (parsedRoot.isMaster) {
    const variant = selectOptimalHlsVariant(parsedRoot.variants);
    if (!variant) return false;
    manifestUrl = variant.url;
    manifestRes = await fetch(manifestUrl, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!manifestRes.ok) return false;
    manifestText = await manifestRes.text();
  }

  if (!isVodHlsPlaylist(manifestText)) {
    // Never fully cache live HLS playlists without #EXT-X-ENDLIST
    return false;
  }

  const rewritten = rewriteHlsPlaylistToLocal(manifestText, manifestUrl, key);
  if (rewritten.assetsToCache.length === 0) return false;

  const now = Date.now();
  await smartCacheDb.putEntry({
    key,
    canonicalUrl: params.resource.url,
    filename,
    kind: 'hls',
    mimeType: 'application/vnd.apple.mpegurl',
    totalBytes: 0,
    hydratedBytes: 0,
    status: 'hydrating',
    storageBackend: 'cache-api',
    segmentCount: rewritten.assetsToCache.length,
    isBookmarked: params.isBookmarked,
    createdAt: now,
    lastAccessedAt: now,
  });

  const cache = await caches.open(SMARTCACHE_MEDIA_CACHE_NAME);
  let totalBytes = 0;
  let nextIdx = 0;
  const concurrency = 2;

  const worker = async () => {
    while (nextIdx < rewritten.assetsToCache.length) {
      if (controller.signal.aborted) throw new Error('aborted');
      const idx = nextIdx;
      nextIdx += 1;
      const item = rewritten.assetsToCache[idx];
      if (!item) continue;

      if (await hasCacheApiEntry(item.localPath)) {
        const existing = await cache.match(item.localPath);
        const buf = existing ? await existing.arrayBuffer() : null;
        if (buf) totalBytes += buf.byteLength;
        continue;
      }

      const segRes = await fetch(item.upstreamUrl, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (!segRes.ok) {
        throw new Error(`segment-http-${segRes.status}`);
      }
      const segBuf = await segRes.arrayBuffer();
      totalBytes += segBuf.byteLength;
      if (totalBytes > MAX_SINGLE_CACHE_BYTES) {
        throw new Error('exceeds-max-single-file');
      }

      const ct = segRes.headers.get('content-type') || 'video/mp2t';
      await writeBufferToCacheApi(item.localPath, segBuf, ct);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, rewritten.assetsToCache.length) }, () =>
        worker(),
      ),
    );
  } catch {
    await deleteSmartCacheArtifacts(key);
    return false;
  }

  const budgetOk = await evictSmartCacheIfNeeded(totalBytes, new Set([key]));
  if (!budgetOk) {
    await deleteSmartCacheArtifacts(key);
    return false;
  }

  const playlistSaved = await writeBufferToCacheApi(
    buildSmartCacheHlsUrl(key),
    rewritten.rewrittenManifest,
    'application/vnd.apple.mpegurl; charset=utf-8',
  );
  if (!playlistSaved) {
    await deleteSmartCacheArtifacts(key);
    return false;
  }

  if (controller.signal.aborted) {
    await deleteSmartCacheArtifacts(key);
    return false;
  }

  await smartCacheDb.mapUrlsToKey(
    [params.resource.url, params.fetchUrl, ...(params.urlsToAlias ?? [])],
    key,
  );

  await smartCacheDb.putEntry({
    key,
    canonicalUrl: params.resource.url,
    filename,
    kind: 'hls',
    mimeType: 'application/vnd.apple.mpegurl',
    totalBytes,
    hydratedBytes: totalBytes,
    status: 'complete',
    storageBackend: 'cache-api',
    segmentCount: rewritten.assetsToCache.length,
    isBookmarked: params.isBookmarked,
    createdAt: now,
    lastAccessedAt: Date.now(),
  });

  return true;
}

export async function triggerVideoHydration(
  params: HydrateVideoParams,
): Promise<boolean> {
  if (typeof window === 'undefined' || !params.fetchUrl) return false;
  if (params.fetchUrl.startsWith('/smartcache/') || params.fetchUrl.startsWith('blob:')) {
    return true;
  }

  await smartCacheDb.init();
  const key = getCanonicalVideoKey(params.resource);
  const existing = smartCacheDb.getEntrySync(key);
  if (existing?.status === 'complete') {
    await smartCacheDb.touchEntry(key);
    return true;
  }
  if (activeHydrations.has(key)) {
    return false;
  }

  void requestSmartCachePersistence();
  const controller = new AbortController();
  activeHydrations.set(key, controller);

  try {
    if (params.isHls) {
      return await hydrateHlsVideo(key, params, controller);
    }
    return await hydrateProgressiveVideo(key, params, controller);
  } catch {
    await deleteSmartCacheArtifacts(key);
    return false;
  } finally {
    activeHydrations.delete(key);
  }
}
