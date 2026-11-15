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
    },
    storage,
  );

  assert.equal(first.ok, true);
  assert.equal(first.data.length, 1);
  assert.equal(
    first.data[0].displayUrl,
    'https://example.com/watch?v=1&token=REDACTED',
  );

  addHistoryEntry(
    {
      id: 'insp-2',
      url: 'https://cdn.example.org/file.mp4',
      displayUrl: 'https://cdn.example.org/file.mp4',
      host: 'cdn.example.org',
      inspectedAt: '2026-11-13T10:05:00.000Z',
      status: 'completed',
    },
    storage,
  );

  const loaded = loadHistory(storage);
  assert.equal(loaded.data.length, 2);
  assert.equal(loaded.data[0].id, 'insp-2');

  const afterRemove = removeHistoryEntry('insp-2', storage);
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

test('history service migrates legacy array entries and drops entries with unsafe schemes', () => {
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
});

test('history service selects curated preview media, strips unsafe URLs, and builds deduplicated resilient image fallback URLs', async () => {
  const { selectHistoryPreviewResources } = await import(
    '../../src/services/history-service'
  );
  const { buildResilientImageCandidates, resolveInlineStreamUrl } = await import(
    '../../src/utils/proxy-url'
  );

  const curated = selectHistoryPreviewResources([
    {
      id: 'res-img-1',
      url: 'https://cdn.example.org/photo.webp',
      host: 'cdn.example.org',
      kind: 'image',
      mimeType: 'image/webp',
      declaredBytes: 24000,
      source: 'html-img',
      observation: 'fetched',
      classification: 'allowed',
      streamUrl: '/api/assets/stream/u1/res-img-1',
    },
    {
      id: 'res-js-1',
      url: 'https://cdn.example.org/app.js',
      host: 'cdn.example.org',
      kind: 'script',
      source: 'html-script',
      observation: 'discovered',
      classification: 'allowed',
    },
    {
      id: 'res-vid-1',
      url: 'https://cdn.example.org/clip.mp4',
      host: 'cdn.example.org',
      kind: 'video',
      mimeType: 'video/mp4',
      source: 'html-video',
      observation: 'fetched',
      classification: 'allowed',
    },
  ]);

  assert.equal(curated.length, 2);
  assert.equal(curated[0].streamUrl, undefined);

  const storage = createMemoryStorage();
  const saved = addHistoryEntry(
    {
      id: 'hist-media-1',
      url: 'https://example.org/gallery',
      displayUrl: 'https://example.org/gallery',
      host: 'example.org',
      inspectedAt: '2026-11-14T10:00:00.000Z',
      status: 'completed',
      previewResources: curated,
      totalResourceCount: 3,
    },
    storage,
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.data[0].previewResources?.length, 2);
  assert.equal(saved.data[0].totalResourceCount, 3);

  assert.equal(
    resolveInlineStreamUrl(
      { id: 'dom-123', url: 'https://cdn.example.org/a.jpg', source: 'browser-observed' },
      '11111111-1111-4111-8111-111111111111',
    ).startsWith('/api/asset?u='),
    true,
  );

  const candidates = buildResilientImageCandidates(
    {
      id: 'res-img-1',
      url: 'https://cdn.example.org/photo.webp',
      classification: 'allowed',
      source: 'html-img',
      streamUrl: '/api/assets/stream/11111111-1111-4111-8111-111111111111/res-img-1',
    },
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(candidates.length, 3);
  assert.ok(candidates[0].startsWith('/api/assets/stream/'));
  assert.ok(candidates[1].startsWith('/api/asset?u='));
  assert.equal(candidates[2], 'https://cdn.example.org/photo.webp');
});

