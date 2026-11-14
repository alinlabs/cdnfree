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

