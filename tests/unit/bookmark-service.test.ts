import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKMARKS_STORAGE_KEY,
  bookmarkToResourceRecord,
  clearAllBookmarks,
  exportBookmarksJson,
  importBookmarksJson,
  loadBookmarks,
  removeBookmarkById,
  toggleResourceBookmark,
} from '../../src/services/bookmark-service';
import type { StorageLike } from '../../src/services/history-service';
import type { ResourceRecord } from '../../src/types/inspection';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function makeResource(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    id: 'res-1',
    url: 'https://cdn.example.com/media/photo.webp',
    host: 'cdn.example.com',
    kind: 'image',
    mimeType: 'image/webp',
    declaredBytes: 42000,
    observation: 'fetched',
    source: 'html-img',
    classification: 'allowed',
    ...overrides,
  };
}

test('toggleResourceBookmark saves and removes media links cleanly with hash deduplication', () => {
  const storage = new MemoryStorage();
  const img = makeResource({
    url: 'https://cdn.example.com/assets/hero.png#top',
  });

  const added = toggleResourceBookmark(img, 'https://example.com/post', storage);
  assert.equal(added.ok, true);
  assert.equal(added.bookmarked, true);
  assert.equal(added.bookmarks.length, 1);
  assert.equal(added.bookmarks[0]?.url, 'https://cdn.example.com/assets/hero.png');
  assert.equal(added.bookmarks[0]?.kind, 'image');
  assert.equal(added.bookmarks[0]?.sourcePageUrl, 'https://example.com/post');

  // Toggling same canonical URL (without hash) removes it
  const removed = toggleResourceBookmark(
    makeResource({ url: 'https://cdn.example.com/assets/hero.png' }),
    undefined,
    storage,
  );
  assert.equal(removed.ok, true);
  assert.equal(removed.bookmarked, false);
  assert.equal(removed.bookmarks.length, 0);
});

test('toggleResourceBookmark rejects unsafe schemes and private hosts', () => {
  const storage = new MemoryStorage();

  const jsRes = toggleResourceBookmark(
    makeResource({ url: 'javascript:alert(1)' }),
    undefined,
    storage,
  );
  assert.equal(jsRes.ok, false);
  assert.equal(jsRes.bookmarked, false);
  assert.equal(jsRes.bookmarks.length, 0);

  const localRes = toggleResourceBookmark(
    makeResource({ url: 'http://127.0.0.1:8080/video.mp4', kind: 'video' }),
    undefined,
    storage,
  );
  assert.equal(localRes.ok, false);
  assert.equal(localRes.bookmarks.length, 0);
});

test('exportBookmarksJson and importBookmarksJson round-trip links safely and deduplicate', () => {
  const storageA = new MemoryStorage();
  toggleResourceBookmark(
    makeResource({ url: 'https://media.example.org/pic.jpg' }),
    'https://example.org',
    storageA,
  );
  toggleResourceBookmark(
    makeResource({
      id: 'res-vid',
      url: 'https://media.example.org/clip.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
    }),
    'https://example.org',
    storageA,
  );

  const exported = exportBookmarksJson(loadBookmarks(storageA).bookmarks);
  const parsedExport = JSON.parse(exported) as {
    version: number;
    count: number;
    bookmarks: Array<{ url: string; kind: string }>;
  };
  assert.equal(parsedExport.version, 1);
  assert.equal(parsedExport.count, 2);

  const storageB = new MemoryStorage();
  const imported = importBookmarksJson(exported, storageB);
  assert.equal(imported.ok, true);
  assert.equal(imported.added, 2);
  assert.equal(imported.skippedDuplicates, 0);
  assert.equal(imported.skippedInvalid, 0);
  assert.equal(imported.bookmarks.length, 2);

  // Re-importing same export skips duplicates cleanly
  const reimported = importBookmarksJson(exported, storageB);
  assert.equal(reimported.ok, true);
  assert.equal(reimported.added, 0);
  assert.equal(reimported.skippedDuplicates, 2);
});

test('importBookmarksJson accepts plain URL arrays, infers image/video kinds, and filters unsafe links', () => {
  const storage = new MemoryStorage();
  const rawList = JSON.stringify([
    'https://cdn.site.test/banner.png',
    'https://cdn.site.test/trailer.mp4?token=abc',
    'https://cdn.site.test/banner.png#dup',
    'http://localhost/secret.jpg',
    'data:image/png;base64,AAAA',
    'not-a-url',
  ]);

  const result = importBookmarksJson(rawList, storage);
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  assert.equal(result.skippedDuplicates, 1);
  assert.equal(result.skippedInvalid, 3);

  const byUrl = new Map(result.bookmarks.map((b) => [b.url, b]));
  assert.equal(byUrl.get('https://cdn.site.test/banner.png')?.kind, 'image');
  assert.equal(
    byUrl.get('https://cdn.site.test/trailer.mp4?token=abc')?.kind,
    'video',
  );
});

test('loadBookmarks recovers cleanly from corrupted JSON and supports remove/clear/resource mapping', () => {
  const storage = new MemoryStorage();
  storage.setItem(BOOKMARKS_STORAGE_KEY, '{corrupt');
  const corrupt = loadBookmarks(storage);
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.bookmarks.length, 0);

  const saved = toggleResourceBookmark(
    makeResource({
      url: 'https://cdn.example.net/film.webm',
      kind: 'video',
      mimeType: 'video/webm',
    }),
    'https://example.net/watch',
    storage,
  );
  const bm = saved.bookmarks[0];
  assert.ok(bm);

  const resource = bookmarkToResourceRecord(bm);
  assert.equal(resource.kind, 'video');
  assert.equal(resource.url, 'https://cdn.example.net/film.webm');
  assert.equal(resource.classification, 'allowed');

  const afterRemove = removeBookmarkById(bm.id, storage);
  assert.equal(afterRemove.bookmarks.length, 0);

  toggleResourceBookmark(makeResource(), undefined, storage);
  const afterClear = clearAllBookmarks(storage);
  assert.equal(afterClear.bookmarks.length, 0);
});
