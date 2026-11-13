import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addHistoryEntry,
  pruneHistoryByRetention,
  type StorageLike,
} from '../../src/services/history-service.ts';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  normalizeAllowlistHostInput,
  resetSettings,
  saveSettings,
} from '../../src/services/settings-service.ts';

function createMemoryStorage(throwOnSet = false): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (throwOnSet) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('normalizeAllowlistHostInput accepts exact public hostnames and rejects wildcards, schemes, or private hosts', () => {
  assert.deepEqual(normalizeAllowlistHostInput('  CDN.Example.COM '), {
    ok: true,
    host: 'cdn.example.com',
  });

  assert.equal(normalizeAllowlistHostInput('*.example.com').ok, false);
  assert.equal(normalizeAllowlistHostInput('https://example.com').ok, false);
  assert.equal(normalizeAllowlistHostInput('example.com/path').ok, false);
  assert.equal(normalizeAllowlistHostInput('localhost').ok, false);
  assert.equal(normalizeAllowlistHostInput('127.0.0.1').ok, false);
  assert.equal(normalizeAllowlistHostInput('192.168.1.5').ok, false);
});

test('settings service loads defaults, persists updates, handles corrupt JSON/quota, and resets', () => {
  const storage = createMemoryStorage();

  assert.equal(loadSettings(storage).data.theme, 'dark');
  assert.equal(loadSettings(storage).data.protection.bypassExternalLinks, true);

  const saved = saveSettings(
    {
      ...DEFAULT_SETTINGS,
      theme: 'light',
      protection: {
        ...DEFAULT_SETTINGS.protection,
        rejectProtocolDowngrade: true,
        bypassExternalLinks: false,
      },
      allowlistedHosts: ['cdn.example.com', 'localhost'],
    },
    storage,
  );

  assert.equal(saved.ok, true);
  assert.equal(saved.data.theme, 'light');
  assert.equal(loadSettings(storage).data.theme, 'light');
  assert.equal(saved.data.protection.rejectProtocolDowngrade, true);
  assert.equal(saved.data.protection.bypassExternalLinks, false);
  assert.deepEqual(saved.data.allowlistedHosts, ['cdn.example.com']);

  storage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ version: 1, theme: 'invalid-value' }),
  );
  assert.equal(loadSettings(storage).data.theme, 'dark');

  storage.setItem(SETTINGS_STORAGE_KEY, '{not-json');
  const recovered = loadSettings(storage);
  assert.equal(recovered.ok, false);
  assert.deepEqual(recovered.data, DEFAULT_SETTINGS);

  const quotaStorage = createMemoryStorage(true);
  const failedSave = saveSettings(DEFAULT_SETTINGS, quotaStorage);
  assert.equal(failedSave.ok, false);
  assert.ok(failedSave.error);

  const reset = resetSettings(storage);
  assert.equal(reset.ok, true);
  assert.deepEqual(reset.data, DEFAULT_SETTINGS);
  assert.equal(reset.data.theme, 'dark');
});

test('pruneHistoryByRetention removes entries older than cutoff days', () => {
  const storage = createMemoryStorage();
  const now = Date.parse('2026-11-13T12:00:00Z');

  addHistoryEntry(
    {
      id: 'old-1',
      url: 'https://old.example.com/',
      displayUrl: 'https://old.example.com/',
      host: 'old.example.com',
      inspectedAt: '2026-10-01T12:00:00Z',
      status: 'completed',
    },
    storage,
  );
  addHistoryEntry(
    {
      id: 'new-1',
      url: 'https://new.example.com/',
      displayUrl: 'https://new.example.com/',
      host: 'new.example.com',
      inspectedAt: '2026-11-12T12:00:00Z',
      status: 'completed',
    },
    storage,
  );

  const pruned = pruneHistoryByRetention(7, storage, now);
  assert.equal(pruned.ok, true);
  assert.equal(pruned.data.length, 1);
  assert.equal(pruned.data[0].id, 'new-1');
});
