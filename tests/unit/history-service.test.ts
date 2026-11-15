import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_STORAGE_KEY,
  addHistoryEntry,
  clearHistory,
  loadHistory,
  removeHistoryEntry,
  type StorageLike,
} from '../../src/services/history-service';
import {
  clearCachedInspections,
  getCachedInspectionById,
  getCachedInspectionByUrl,
  removeCachedInspection,
  saveCachedInspection,
} from '../../src/services/inspection-cache';
import type { InspectionResult } from '../../src/types/inspection';
import {
  buildHistoryDisplayUrl,
  formatHistoryAssetSummary,
  formatHistoryHeadline,
} from '../../src/utils/history-format';

function createMemoryStorage(options?: { throwOnSet?: boolean }): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (options?.throwOnSet) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('history service adds, deduplicates, redacts, removes, and clears entries', () => {
  const storage = createMemoryStorage();

  const first = addHistoryEntry(
    {
      id: 'insp-1',
      url: 'https://example.com/watch?v=1&token=supersecret',
      displayUrl: 'https://example.com/watch?v=1&token=supersecret',
      host: 'example.com',
      inspectedAt: '2026-11-13T10:00:00.000Z',
      status: 'completed',
      searchMode: 'single',
      targetKind: 'web',
      routePath: '/search?ur=example.com%2Fwatch%3Fv%3D1',
      totalResourceCount: 12,
    },
    storage,
  );

  assert.equal(first.ok, true);
  assert.equal(first.data.length, 1);
  assert.equal(
    first.data[0].displayUrl,
    'https://example.com/watch?v=1&token=REDACTED',
  );
  assert.equal(first.data[0].searchMode, 'single');
  assert.equal(first.data[0].targetKind, 'web');

  addHistoryEntry(
    {
      id: 'bulk-1',
      url: 'https://cdn.example.org/file.mp4',
      displayUrl: 'https://cdn.example.org/file.mp4',
      host: 'cdn.example.org',
      inspectedAt: '2026-11-16T02:12:00.000Z',
      status: 'completed',
      searchMode: 'bulk',
      targetKind: 'aset',
      assetCategory: 'video',
      routePath: '/search/aset?bulk=abcdefg0&jenis=video',
      bulkUrls: ['https://cdn.example.org/file.mp4', 'https://media.example.net/v'],
      totalResourceCount: 53,
    },
    storage,
  );

  const loaded = loadHistory(storage);
  assert.equal(loaded.data.length, 2);
  assert.equal(loaded.data[0].id, 'bulk-1');
  assert.equal(loaded.data[0].assetCategory, 'video');
  assert.equal(loaded.data[0].bulkUrls?.length, 2);

  const afterRemove = removeHistoryEntry('bulk-1', storage);
  assert.equal(afterRemove.data.length, 1);
  assert.equal(afterRemove.data[0].id, 'insp-1');

  const cleared = clearHistory(storage);
  assert.equal(cleared.ok, true);
  assert.equal(loadHistory(storage).data.length, 0);
});

test('history service handles malformed JSON and storage quota errors safely', () => {
  const corruptStorage = createMemoryStorage();
  corruptStorage.setItem(HISTORY_STORAGE_KEY, '{not-valid-json');
  const loadedCorrupt = loadHistory(corruptStorage);
  assert.equal(loadedCorrupt.ok, false);
  assert.deepEqual(loadedCorrupt.data, []);

  const fullStorage = createMemoryStorage({ throwOnSet: true });
  const writeResult = addHistoryEntry(
    {
      id: 'insp-3',
      url: 'https://example.com/',
      displayUrl: 'https://example.com/',
      host: 'example.com',
      inspectedAt: '2026-11-13T10:10:00.000Z',
      status: 'completed',
    },
    fullStorage,
  );
  assert.equal(writeResult.ok, false);
  assert.ok(writeResult.error);
});

test('history service migrates legacy entries, strips previewResources, and drops unsafe schemes', () => {
  const legacyStorage = createMemoryStorage();
  legacyStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify([
      {
        id: 'legacy-1',
        url: 'https://legacy.example.com/page?apiKey=secret123',
        host: 'legacy.example.com',
        inspectedAt: '2026-10-01T08:00:00.000Z',
        status: 'completed',
        previewResources: [
          {
            id: 'r1',
            url: 'https://legacy.example.com/img.png',
            host: 'legacy.example.com',
            kind: 'image',
          },
        ],
        totalResourceCount: 7,
      },
      {
        id: 'tampered-1',
        url: 'javascript:alert(1)',
        host: 'evil.example',
        inspectedAt: '2026-10-01T09:00:00.000Z',
        status: 'completed',
      },
    ]),
  );

  const migrated = loadHistory(legacyStorage);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.data.length, 1);
  assert.equal(migrated.data[0].id, 'legacy-1');
  assert.equal(
    migrated.data[0].displayUrl,
    'https://legacy.example.com/page?apiKey=REDACTED',
  );
  assert.equal('previewResources' in migrated.data[0], false);
  assert.equal(migrated.data[0].totalResourceCount, 7);
});

test('history formatting helpers produce exact list-only labels and CDNFREE URLs', () => {
  const bulkVideoEntry = {
    id: 'abcdefg0',
    url: 'https://site-a.example/watch',
    displayUrl: 'https://site-a.example/watch',
    host: 'site-a.example',
    inspectedAt: '2026-11-16T02:12:00.000Z',
    status: 'completed' as const,
    searchMode: 'bulk' as const,
    targetKind: 'aset' as const,
    assetCategory: 'video' as const,
    routePath: '/search/aset?bulk=abcdefg0&jenis=video',
    totalResourceCount: 53,
  };

  assert.equal(formatHistoryHeadline(bulkVideoEntry), 'Bulk Link Aset Video');
  assert.equal(
    buildHistoryDisplayUrl(bulkVideoEntry, 'https://cdnfree.vercel.app'),
    'https://cdnfree.vercel.app/search/aset?bulk=abcdefg0&jenis=video',
  );
  assert.equal(formatHistoryAssetSummary(bulkVideoEntry), '53 Aset Video');

  const singleWebEntry = {
    id: 'single-1',
    url: 'https://example.com/news',
    displayUrl: 'https://example.com/news',
    host: 'example.com',
    inspectedAt: '2026-12-06T22:00:00.000Z',
    status: 'completed' as const,
    searchMode: 'single' as const,
    targetKind: 'web' as const,
    routePath: '/search?ur=example.com%2Fnews',
    totalResourceCount: 19,
  };

  assert.equal(formatHistoryHeadline(singleWebEntry), 'Single Link Web');
  assert.equal(formatHistoryAssetSummary(singleWebEntry), '19 aset terdeteksi');
});

test('inspection-cache saves, retrieves by ID and URL, and removes entries cleanly', async () => {
  await clearCachedInspections();

  const sampleResult: InspectionResult = {
    id: 'insp-cache-1',
    submittedUrl: 'https://example.org/videos',
    finalUrl: 'https://example.org/videos',
    page: {
      title: 'Video Gallery',
      statusCode: 200,
      contentType: 'text/html',
      isIdn: false,
    },
    redirects: [],
    resources: [
      {
        id: 'res-1',
        url: 'https://cdn.example.org/clip.mp4',
        host: 'cdn.example.org',
        kind: 'video',
        mimeType: 'video/mp4',
        source: 'html-video',
        observation: 'fetched',
        classification: 'allowed',
      },
    ],
    links: [],
    cdnHosts: [],
    summary: {
      inspectedAt: '2026-11-16T02:12:00.000Z',
      durationMs: 120,
      redirectCount: 0,
      resourceCount: 1,
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

  await saveCachedInspection(sampleResult);

  const byId = await getCachedInspectionById('insp-cache-1');
  assert.equal(byId?.id, 'insp-cache-1');
  assert.equal(byId?.resources.length, 1);

  const byUrl = await getCachedInspectionByUrl('https://example.org/videos');
  assert.equal(byUrl?.id, 'insp-cache-1');

  await removeCachedInspection('insp-cache-1');
  assert.equal(await getCachedInspectionById('insp-cache-1'), null);
  assert.equal(await getCachedInspectionByUrl('https://example.org/videos'), null);
});
