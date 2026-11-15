export type SmartCacheStatus = 'hydrating' | 'complete' | 'error';
export type SmartCacheBackend = 'opfs' | 'cache-api';

export interface SmartCacheEntry {
  key: string;
  canonicalUrl: string;
  filename: string;
  kind: 'video' | 'hls';
  mimeType: string;
  totalBytes: number;
  hydratedBytes: number;
  status: SmartCacheStatus;
  storageBackend: SmartCacheBackend;
  segmentCount?: number;
  isBookmarked?: boolean;
  createdAt: number;
  lastAccessedAt: number;
  errorMessage?: string;
}

export interface SmartCacheUrlMapping {
  url: string;
  key: string;
  updatedAt: number;
}

export interface SmartCachePosterRecord {
  key: string;
  dataUrl: string;
  updatedAt: number;
}

export const SMARTCACHE_DB_NAME = 'cdnfree-smartcache-db';
export const SMARTCACHE_DB_VERSION = 1;
export const SMARTCACHE_ENTRIES_STORE = 'entries';
export const SMARTCACHE_URLMAP_STORE = 'urlMap';
export const SMARTCACHE_POSTERS_STORE = 'posters';
export const POSTER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_POSTERS = 200;

type DbListener = () => void;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openSmartCacheDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SMARTCACHE_DB_NAME, SMARTCACHE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SMARTCACHE_ENTRIES_STORE)) {
          db.createObjectStore(SMARTCACHE_ENTRIES_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(SMARTCACHE_URLMAP_STORE)) {
          db.createObjectStore(SMARTCACHE_URLMAP_STORE, { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains(SMARTCACHE_POSTERS_STORE)) {
          db.createObjectStore(SMARTCACHE_POSTERS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function txRequest<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

class SmartCacheDbManager {
  private entries = new Map<string, SmartCacheEntry>();
  private posters = new Map<string, SmartCachePosterRecord>();
  private listeners = new Set<DbListener>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private getDb(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) {
      this.dbPromise = openSmartCacheDb();
    }
    return this.dbPromise;
  }

  private emit(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }

  subscribe(listener: DbListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const db = await this.getDb();
      if (!db) {
        this.initialized = true;
        return;
      }

      try {
        const tx = db.transaction(
          [SMARTCACHE_ENTRIES_STORE, SMARTCACHE_POSTERS_STORE],
          'readonly',
        );
        const allEntries =
          (await txRequest<SmartCacheEntry[]>(
            tx.objectStore(SMARTCACHE_ENTRIES_STORE).getAll(),
          )) ?? [];
        const allPosters =
          (await txRequest<SmartCachePosterRecord[]>(
            tx.objectStore(SMARTCACHE_POSTERS_STORE).getAll(),
          )) ?? [];
        await txDone(tx);

        const now = Date.now();
        for (const entry of allEntries) {
          if (entry && entry.key) {
            // Reset interrupted hydrating states on fresh page load
            if (entry.status === 'hydrating') {
              this.entries.set(entry.key, { ...entry, status: 'error' });
            } else {
              this.entries.set(entry.key, entry);
            }
          }
        }
        for (const poster of allPosters) {
          if (poster && poster.key && now - poster.updatedAt <= POSTER_TTL_MS) {
            this.posters.set(poster.key, poster);
          }
        }
      } catch {
        // Ignore IDB read issues in restricted modes
      } finally {
        this.initialized = true;
        this.emit();
      }
    })();

    return this.initPromise;
  }

  getEntrySync(key: string): SmartCacheEntry | null {
    return this.entries.get(key) ?? null;
  }

  hasCompleteSync(key: string): boolean {
    return this.entries.get(key)?.status === 'complete';
  }

  listEntriesSync(): SmartCacheEntry[] {
    return Array.from(this.entries.values()).sort(
      (a, b) => b.lastAccessedAt - a.lastAccessedAt,
    );
  }

  getPosterSync(key: string): string | null {
    const rec = this.posters.get(key);
    if (!rec) return null;
    if (Date.now() - rec.updatedAt > POSTER_TTL_MS) {
      this.posters.delete(key);
      return null;
    }
    return rec.dataUrl;
  }

  getPosterBytesSync(key: string): number {
    const dataUrl = this.getPosterSync(key);
    if (!dataUrl) return 0;
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(dataUrl).byteLength
      : dataUrl.length;
  }

  async setBookmarkedFlag(key: string, isBookmarked: boolean): Promise<void> {
    const existing = this.entries.get(key);
    if (!existing || Boolean(existing.isBookmarked) === isBookmarked) return;
    await this.putEntry({ ...existing, isBookmarked });
  }

  async putEntry(entry: SmartCacheEntry): Promise<void> {
    this.entries.set(entry.key, entry);
    this.emit();

    const db = await this.getDb();
    if (!db) return;
    try {
      const tx = db.transaction(SMARTCACHE_ENTRIES_STORE, 'readwrite');
      tx.objectStore(SMARTCACHE_ENTRIES_STORE).put(entry);
      await txDone(tx);
    } catch {
      // Ignore IDB write error
    }
  }

  async touchEntry(key: string): Promise<void> {
    const existing = this.entries.get(key);
    if (!existing) return;
    const updated = { ...existing, lastAccessedAt: Date.now() };
    await this.putEntry(updated);
  }

  async deleteEntry(key: string): Promise<void> {
    this.entries.delete(key);
    this.posters.delete(key);
    this.emit();

    const db = await this.getDb();
    if (!db) return;
    try {
      const tx = db.transaction(
        [
          SMARTCACHE_ENTRIES_STORE,
          SMARTCACHE_URLMAP_STORE,
          SMARTCACHE_POSTERS_STORE,
        ],
        'readwrite',
      );
      tx.objectStore(SMARTCACHE_ENTRIES_STORE).delete(key);
      tx.objectStore(SMARTCACHE_POSTERS_STORE).delete(key);
      const urlStore = tx.objectStore(SMARTCACHE_URLMAP_STORE);
      const mappings = (await txRequest<SmartCacheUrlMapping[]>(urlStore.getAll())) ?? [];
      for (const m of mappings) {
        if (m.key === key) {
          urlStore.delete(m.url);
        }
      }
      await txDone(tx);
    } catch {
      // Ignore
    }
  }

  async mapUrlsToKey(urls: string[], key: string): Promise<void> {
    const unique = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
    if (unique.length === 0) return;
    const db = await this.getDb();
    if (!db) return;
    try {
      const tx = db.transaction(SMARTCACHE_URLMAP_STORE, 'readwrite');
      const store = tx.objectStore(SMARTCACHE_URLMAP_STORE);
      const now = Date.now();
      for (const url of unique) {
        store.put({ url, key, updatedAt: now } satisfies SmartCacheUrlMapping);
      }
      await txDone(tx);
    } catch {
      // Ignore
    }
  }

  async savePoster(key: string, dataUrl: string): Promise<void> {
    if (!key || !dataUrl || dataUrl.length > 260_000) return;
    const record: SmartCachePosterRecord = {
      key,
      dataUrl,
      updatedAt: Date.now(),
    };
    this.posters.set(key, record);

    // Trim oldest posters in memory if exceeding MAX_POSTERS
    if (this.posters.size > MAX_POSTERS) {
      const sorted = Array.from(this.posters.values()).sort(
        (a, b) => a.updatedAt - b.updatedAt,
      );
      const excess = sorted.slice(0, this.posters.size - MAX_POSTERS);
      for (const item of excess) {
        this.posters.delete(item.key);
      }
    }

    this.emit();
    const db = await this.getDb();
    if (!db) return;
    try {
      const tx = db.transaction(SMARTCACHE_POSTERS_STORE, 'readwrite');
      tx.objectStore(SMARTCACHE_POSTERS_STORE).put(record);
      await txDone(tx);
    } catch {
      // Ignore
    }
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
    this.posters.clear();
    this.emit();

    const db = await this.getDb();
    if (!db) return;
    try {
      const tx = db.transaction(
        [SMARTCACHE_ENTRIES_STORE, SMARTCACHE_URLMAP_STORE, SMARTCACHE_POSTERS_STORE],
        'readwrite',
      );
      tx.objectStore(SMARTCACHE_ENTRIES_STORE).clear();
      tx.objectStore(SMARTCACHE_URLMAP_STORE).clear();
      tx.objectStore(SMARTCACHE_POSTERS_STORE).clear();
      await txDone(tx);
    } catch {
      // Ignore
    }
  }
}

export const smartCacheDb = new SmartCacheDbManager();
