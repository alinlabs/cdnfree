import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAllBulkSessions,
  getBulkInspectionSession,
  restoreBulkInspectionSession,
} from '../../src/services/bulk-inspection-store.ts';
import {
  collectBookmarkSmartCacheKeys,
  computeBookmarkMediaCacheBytes,
  getUtf8ByteLength,
  measureStorageKeysBytes,
  purgeAllHistoryCaches,
  purgeBookmarkMediaCache,
  purgeHistoryEntryCaches,
  resolveFooterCacheMode,
} from '../../src/services/cache-footprint.ts';
import {
  getCachedInspectionById,
  saveCachedInspection,
} from '../../src/services/inspection-cache.ts';
import { smartCacheDb, type SmartCacheEntry } from '../../src/services/smart-cache-db.ts';
import {
  getCanonicalVideoKey,
  videoPlaybackStore,
} from '../../src/services/video-playback-store.ts';
import type { InspectionResult } from '../../src/types/inspection.ts';

function makeInspection(id: string, url: string): InspectionResult {
  return {
    id,
    submittedUrl: url,
    finalUrl: url,
    page: {
      title: `Page ${id}`,
      statusCode: 200,
      contentType: 'text/html',
      isIdn: false,
    },
    redirects: [],
    resources: [],
    links: [],
    cdnHosts: [],
    summary: {
      inspectedAt: new Date().toISOString(),
      durationMs: 100,
      redirectCount: 0,
      resourceCount: 0,
      blockedCount: 0,
      flaggedCount: 0,
      reviewCount: 0,
      unsafeSchemeCount: 0,
      limitations: [],
    },
    preview: {
      mode: 'embeddable',
    },
  };
}

test('resolveFooterCacheMode maps history and bookmark routes cleanly', () => {
  assert.equal(resolveFooterCacheMode('/riwayat-pencarian'), 'riwayat');
  assert.equal(resolveFooterCacheMode('/riwayat-pencarian/'), 'riwayat');
  assert.equal(resolveFooterCacheMode('/markah'), 'markah');
  assert.equal(resolveFooterCacheMode('/markah/'), 'markah');
  assert.equal(resolveFooterCacheMode('/'), null);
  assert.equal(resolveFooterCacheMode('/pengaturan'), null);
  assert.equal(resolveFooterCacheMode('/search/abc'), null);
});

test('getUtf8ByteLength and measureStorageKeysBytes calculate UTF-8 storage bytes', () => {
  assert.equal(getUtf8ByteLength(''), 0);
  assert.equal(getUtf8ByteLength('abc'), 3);
  assert.equal(getUtf8ByteLength('é'), 2);

  const mem = new Map<string, string>([
    ['k1', 'hello'],
    ['k2', 'café'],
  ]);
  const storage = { getItem: (k: string) => mem.get(k) ?? null };
  assert.equal(measureStorageKeysBytes(storage, ['k1', 'k2', 'missing']), 10);
  assert.equal(measureStorageKeysBytes(null, ['k1']), 0);
});

test('computeBookmarkMediaCacheBytes deduplicates keys and includes complete, hydrating, and poster bytes', () => {
  const videoUrl = 'https://cdn.example.com/clip.mp4';
  const hlsUrl = 'https://cdn.example.com/live/master.m3u8';
  const videoKey = getCanonicalVideoKey(videoUrl);
  const hlsKey = getCanonicalVideoKey(hlsUrl);

  const keys = collectBookmarkSmartCacheKeys([
    { url: videoUrl, smartCacheKey: videoKey },
    { url: videoUrl, hlsUrl },
  ]);
  assert.ok(keys.has(videoKey));
  assert.ok(keys.has(hlsKey));

  const entries: SmartCacheEntry[] = [
    {
      key: videoKey,
      canonicalUrl: videoUrl,
      filename: 'clip.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      totalBytes: 2048,
      hydratedBytes: 2048,
      status: 'complete',
      storageBackend: 'cache-api',
      createdAt: 1,
      lastAccessedAt: 1,
    },
    {
      key: hlsKey,
      canonicalUrl: hlsUrl,
      filename: 'master.m3u8',
      kind: 'hls',
      mimeType: 'application/vnd.apple.mpegurl',
      totalBytes: 5000,
      hydratedBytes: 1500,
      status: 'hydrating',
      storageBackend: 'cache-api',
      createdAt: 1,
      lastAccessedAt: 1,
    },
    {
      key: 'unbookmarked-key',
      canonicalUrl: 'https://cdn.example.com/other.mp4',
      filename: 'other.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      totalBytes: 99999,
      hydratedBytes: 99999,
      status: 'complete',
      storageBackend: 'opfs',
      createdAt: 1,
      lastAccessedAt: 1,
    },
  ];

  const bytes = computeBookmarkMediaCacheBytes(
    [{ url: videoUrl, smartCacheKey: videoKey }, { url: videoUrl, hlsUrl }],
    entries,
    (k) => (k === videoKey ? 300 : k === hlsKey ? 100 : 9000),
  );
  assert.equal(bytes, 2048 + 300 + 1500 + 100);
});

test('purgeBookmarkMediaCache removes SmartCache entry, poster, and playback snapshot for unbookmarked media', async () => {
  const url = 'https://cdn.example.com/saved-video.mp4';
  const key = getCanonicalVideoKey(url);

  await smartCacheDb.putEntry({
    key,
    canonicalUrl: url,
    filename: 'saved-video.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    totalBytes: 4096,
    hydratedBytes: 4096,
    status: 'complete',
    storageBackend: 'cache-api',
    isBookmarked: true,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  });
  await smartCacheDb.savePoster(key, 'data:image/jpeg;base64,AAAA');
  videoPlaybackStore.saveSnapshot(url, { currentTime: 12, duration: 60 });

  assert.ok(smartCacheDb.getEntrySync(key));
  assert.ok(smartCacheDb.getPosterSync(key));
  assert.ok(videoPlaybackStore.getSnapshot(url));

  await purgeBookmarkMediaCache([{ url, smartCacheKey: key }]);

  assert.equal(smartCacheDb.getEntrySync(key), null);
  assert.equal(smartCacheDb.getPosterSync(key), null);
  assert.equal(videoPlaybackStore.getSnapshot(url), null);
});

test('purgeHistoryEntryCaches deletes removed inspection & bulk caches while keeping shared references', async () => {
  await purgeAllHistoryCaches();
  clearAllBulkSessions();

  const sharedSite = makeInspection('site-shared', 'https://shared.example.com/');
  const onlyFirstSite = makeInspection('site-only-1', 'https://one.example.com/');
  const singleEntry = makeInspection('single-1', 'https://single.example.com/');

  await Promise.all([
    saveCachedInspection(sharedSite),
    saveCachedInspection(onlyFirstSite),
    saveCachedInspection(singleEntry),
  ]);

  const bulk1 = restoreBulkInspectionSession('bulk-1', [
    'https://shared.example.com/',
    'https://one.example.com/',
  ]);
  bulk1.items['https://shared.example.com/'] = {
    url: 'https://shared.example.com/',
    status: 'success',
    inspectionId: 'site-shared',
    result: sharedSite,
  };
  bulk1.items['https://one.example.com/'] = {
    url: 'https://one.example.com/',
    status: 'success',
    inspectionId: 'site-only-1',
    result: onlyFirstSite,
  };

  const bulk2 = restoreBulkInspectionSession('bulk-2', [
    'https://shared.example.com/',
  ]);
  bulk2.items['https://shared.example.com/'] = {
    url: 'https://shared.example.com/',
    status: 'success',
    inspectionId: 'site-shared',
    result: sharedSite,
  };

  await purgeHistoryEntryCaches(
    [
      { id: 'bulk-1', url: 'https://cdnfree.app/bulk-1', searchMode: 'bulk' },
      { id: 'single-1', url: 'https://single.example.com/', searchMode: 'single' },
    ],
    [{ id: 'bulk-2', url: 'https://cdnfree.app/bulk-2', searchMode: 'bulk' }],
  );

  assert.equal(getBulkInspectionSession('bulk-1'), null);
  assert.ok(getBulkInspectionSession('bulk-2'));
  assert.equal(await getCachedInspectionById('single-1'), null);
  assert.equal(await getCachedInspectionById('site-only-1'), null);
  assert.ok(await getCachedInspectionById('site-shared'));

  await purgeAllHistoryCaches();
  assert.equal(getBulkInspectionSession('bulk-2'), null);
  assert.equal(await getCachedInspectionById('site-shared'), null);
});

test('purgeHistoryEntryCaches cleans up prior re-inspected cache records for the deleted single URL', async () => {
  await purgeAllHistoryCaches();
  clearAllBulkSessions();

  const oldInsp = makeInspection('old-reinsp', 'https://reinspected.example.com/');
  const newInsp = makeInspection('new-reinsp', 'https://reinspected.example.com/');
  await saveCachedInspection(oldInsp);
  await saveCachedInspection(newInsp);

  await purgeHistoryEntryCaches(
    [{ id: 'new-reinsp', url: 'https://reinspected.example.com/', searchMode: 'single' }],
    [],
  );

  assert.equal(await getCachedInspectionById('new-reinsp'), null);
  assert.equal(await getCachedInspectionById('old-reinsp'), null);
});

test('purgeBookmarkMediaCache prevents immediate unmount flush from resurrecting playback snapshot', async () => {
  const url = 'https://cdn.example.com/unmount-guard.mp4';
  const key = getCanonicalVideoKey(url);

  videoPlaybackStore.saveSnapshot(key, { currentTime: 25, duration: 90, wasPlaying: true }, { immediate: true });
  assert.ok(videoPlaybackStore.getSnapshot(key));

  await purgeBookmarkMediaCache([{ url, smartCacheKey: key }]);
  assert.equal(videoPlaybackStore.getSnapshot(key), null);

  // Simulate immediate unmount flush right after unbookmarking
  videoPlaybackStore.saveSnapshot(
    key,
    { currentTime: 25, duration: 90, wasPlaying: true },
    { immediate: true, isUnmountFlush: true },
  );
  assert.equal(videoPlaybackStore.getSnapshot(key), null);
});

