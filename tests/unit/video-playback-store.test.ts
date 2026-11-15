import test from 'node:test';
import assert from 'node:assert/strict';
import type { StorageLike } from '../../src/services/history-service.ts';
import {
  getCanonicalVideoKey,
  MAX_PLAYBACK_SNAPSHOTS,
  normalizeCanonicalVideoUrl,
  VideoPlaybackStore,
} from '../../src/services/video-playback-store.ts';

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

test('normalizeCanonicalVideoUrl and getCanonicalVideoKey align local bundled variants and strip hashes', () => {
  assert.equal(
    normalizeCanonicalVideoUrl('/src/assets/into-landscape.mp4'),
    '/local-asset/into-landscape.mp4',
  );
  assert.equal(
    normalizeCanonicalVideoUrl('/assets/into-landscape-Xyz987.mp4'),
    '/local-asset/into-landscape.mp4',
  );
  assert.equal(
    getCanonicalVideoKey('/src/assets/into-landscape.mp4'),
    getCanonicalVideoKey('/assets/into-landscape-ProdHash.mp4'),
  );
  assert.equal(
    getCanonicalVideoKey('https://cdn.example.com/clip.mp4#t=10'),
    getCanonicalVideoKey('https://cdn.example.com/clip.mp4'),
  );
});

test('VideoPlaybackStore saves, persists, notifies subscribers, and marks directFailed', () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const store = new VideoPlaybackStore(session, local);
  const key = getCanonicalVideoKey('https://cdn.example.com/movie.mp4');

  const events: number[] = [];
  const unsub = store.subscribe(key, (snap) => {
    events.push(snap.currentTime);
  });

  store.saveSnapshot(
    key,
    { currentTime: 14.5, duration: 120, wasPlaying: true, playbackRate: 1.5, isMuted: false },
    { immediate: true, notify: true },
  );
  assert.deepEqual(events, [14.5]);

  // Reloading from persistence restores exact state
  const reloaded = new VideoPlaybackStore(session, local);
  const restored = reloaded.getSnapshot(key);
  assert.ok(restored);
  assert.equal(restored.currentTime, 14.5);
  assert.equal(restored.duration, 120);
  assert.equal(restored.wasPlaying, true);
  assert.equal(restored.playbackRate, 1.5);

  unsub();
  reloaded.markDirectFailed(key);
  assert.equal(reloaded.getSnapshot(key)?.directFailed, true);
  assert.equal(reloaded.getSnapshot(key)?.preferredSourceMode, 'stream');
});

test('VideoPlaybackStore enforces MAX_PLAYBACK_SNAPSHOTS LRU eviction limit', () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const store = new VideoPlaybackStore(session, local);

  for (let i = 0; i < MAX_PLAYBACK_SNAPSHOTS + 25; i += 1) {
    store.saveSnapshot(
      `key-${i}`,
      { currentTime: i, updatedAt: 1_000_000 + i },
      { immediate: false, notify: false },
    );
  }
  store.flushStorage();

  // Oldest 25 entries evicted, newest preserved
  assert.equal(store.getSnapshot('key-0'), null);
  assert.equal(store.getSnapshot('key-24'), null);
  assert.ok(store.getSnapshot('key-25'));
  assert.ok(store.getSnapshot(`key-${MAX_PLAYBACK_SNAPSHOTS + 24}`));
});
