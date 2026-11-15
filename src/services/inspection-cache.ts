import type { InspectionResult } from '../types/inspection';
import { formatCleanUrl } from '../utils/clean-url';

const DB_NAME = 'cdnfree-inspection-cache-db';
const DB_VERSION = 1;
const STORE_NAME = 'inspections';
const URL_INDEX_STORAGE_KEY = 'cdnfree:inspection-url-index:v1';
const MAX_CACHED_INSPECTIONS = 50;

interface CachedInspectionRecord {
  id: string;
  cleanUrl: string;
  updatedAt: number;
  result: InspectionResult;
}

interface UrlIndexEntry {
  id: string;
  updatedAt: number;
}

const memoryById = new Map<string, CachedInspectionRecord>();
const memoryUrlIndex = new Map<string, UrlIndexEntry>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function readUrlIndex(): Record<string, UrlIndexEntry> {
  const merged: Record<string, UrlIndexEntry> = {};
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(URL_INDEX_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (
              v &&
              typeof v === 'object' &&
              typeof (v as UrlIndexEntry).id === 'string' &&
              typeof (v as UrlIndexEntry).updatedAt === 'number'
            ) {
              merged[k] = v as UrlIndexEntry;
            }
          }
        }
      }
    } catch {
      // Ignore storage access errors
    }
  }
  for (const [k, v] of memoryUrlIndex.entries()) {
    merged[k] = v;
  }
  return merged;
}

function writeUrlIndexEntry(cleanUrl: string, id: string, updatedAt: number): void {
  if (!cleanUrl) return;
  const entry: UrlIndexEntry = { id, updatedAt };
  memoryUrlIndex.set(cleanUrl, entry);

  if (typeof window === 'undefined') return;
  try {
    const map = readUrlIndex();
    delete map[cleanUrl];
    map[cleanUrl] = entry;
    const entries = Object.entries(map).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const trimmed =
      entries.length > MAX_CACHED_INSPECTIONS
        ? Object.fromEntries(entries.slice(-MAX_CACHED_INSPECTIONS))
        : Object.fromEntries(entries);
    window.localStorage.setItem(URL_INDEX_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
}

function removeUrlIndexById(id: string): void {
  for (const [key, val] of memoryUrlIndex.entries()) {
    if (val.id === id) {
      memoryUrlIndex.delete(key);
    }
  }
  if (typeof window === 'undefined') return;
  try {
    const map = readUrlIndex();
    let changed = false;
    for (const [key, val] of Object.entries(map)) {
      if (val.id === id) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) {
      if (Object.keys(map).length === 0) {
        window.localStorage.removeItem(URL_INDEX_STORAGE_KEY);
      } else {
        window.localStorage.setItem(URL_INDEX_STORAGE_KEY, JSON.stringify(map));
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function touchMemoryRecord(record: CachedInspectionRecord): void {
  if (memoryById.has(record.id)) {
    memoryById.delete(record.id);
  }
  memoryById.set(record.id, record);
  while (memoryById.size > MAX_CACHED_INSPECTIONS) {
    const oldestKey = memoryById.keys().next().value;
    if (!oldestKey) break;
    memoryById.delete(oldestKey);
  }
}

async function pruneOldestDbRecords(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - MAX_CACHED_INSPECTIONS;
        if (excess <= 0) return;
        const index = store.index('updatedAt');
        let deleted = 0;
        const cursorReq = index.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || deleted >= excess) return;
          cursor.delete();
          deleted += 1;
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function emitInspectionCacheChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('cdnfree:cache-footprint-changed'));
  }
}

function measureRecordBytes(record: CachedInspectionRecord): number {
  const json = JSON.stringify(record);
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(json).byteLength
    : json.length;
}

export async function getInspectionCacheBytes(): Promise<number> {
  const db = await openCacheDb();
  if (!db) {
    let fallbackBytes = 0;
    for (const record of memoryById.values()) {
      fallbackBytes += measureRecordBytes(record);
    }
    return fallbackBytes;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = Array.isArray(req.result)
          ? (req.result as CachedInspectionRecord[])
          : [];
        let total = 0;
        for (const rec of records) {
          total += measureRecordBytes(rec);
        }
        resolve(total);
      };
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function saveCachedInspection(result: InspectionResult): Promise<void> {
  const destinationUrl = result.finalUrl || result.submittedUrl;
  const cleanFinal = formatCleanUrl(destinationUrl);
  const cleanSubmitted = formatCleanUrl(result.submittedUrl);
  const updatedAt = Date.now();

  const record: CachedInspectionRecord = {
    id: result.id,
    cleanUrl: cleanFinal || cleanSubmitted,
    updatedAt,
    result,
  };

  touchMemoryRecord(record);
  if (cleanFinal) writeUrlIndexEntry(cleanFinal, result.id, updatedAt);
  if (cleanSubmitted && cleanSubmitted !== cleanFinal) {
    writeUrlIndexEntry(cleanSubmitted, result.id, updatedAt);
  }

  const db = await openCacheDb();
  if (!db) {
    emitInspectionCacheChanged();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  await pruneOldestDbRecords(db);
  emitInspectionCacheChanged();
}

export async function getCachedInspectionById(
  id: string,
): Promise<InspectionResult | null> {
  if (!id) return null;
  const fromMemory = memoryById.get(id);
  if (fromMemory) {
    return fromMemory.result;
  }

  const db = await openCacheDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as CachedInspectionRecord | undefined;
        if (record?.result) {
          touchMemoryRecord(record);
          resolve(record.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedInspectionByUrl(
  url: string,
): Promise<InspectionResult | null> {
  const cleanKey = formatCleanUrl(url);
  if (!cleanKey) return null;

  for (const record of Array.from(memoryById.values()).reverse()) {
    if (
      record.cleanUrl === cleanKey ||
      formatCleanUrl(record.result.submittedUrl) === cleanKey ||
      formatCleanUrl(record.result.finalUrl) === cleanKey
    ) {
      return record.result;
    }
  }

  const index = readUrlIndex();
  const indexed = index[cleanKey];
  if (indexed?.id) {
    const byId = await getCachedInspectionById(indexed.id);
    if (byId) return byId;
  }

  return null;
}

export async function removeCachedInspection(id: string): Promise<void> {
  if (!id) return;
  memoryById.delete(id);
  removeUrlIndexById(id);

  const db = await openCacheDb();
  if (!db) {
    emitInspectionCacheChanged();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  emitInspectionCacheChanged();
}

export async function removeCachedInspectionsByUrl(
  url: string,
  excludeIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const cleanKey = formatCleanUrl(url);
  if (!cleanKey) return;

  for (const [id, record] of memoryById.entries()) {
    if (excludeIds.has(id)) continue;
    if (
      record.cleanUrl === cleanKey ||
      formatCleanUrl(record.result.submittedUrl) === cleanKey ||
      formatCleanUrl(record.result.finalUrl) === cleanKey
    ) {
      memoryById.delete(id);
      removeUrlIndexById(id);
    }
  }

  const index = readUrlIndex();
  const indexed = index[cleanKey];
  if (indexed?.id && !excludeIds.has(indexed.id)) {
    removeUrlIndexById(indexed.id);
  }

  const db = await openCacheDb();
  if (!db) {
    emitInspectionCacheChanged();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = Array.isArray(req.result)
          ? (req.result as CachedInspectionRecord[])
          : [];
        for (const rec of records) {
          if (!rec || excludeIds.has(rec.id)) continue;
          if (
            rec.cleanUrl === cleanKey ||
            formatCleanUrl(rec.result?.submittedUrl ?? '') === cleanKey ||
            formatCleanUrl(rec.result?.finalUrl ?? '') === cleanKey
          ) {
            store.delete(rec.id);
            memoryById.delete(rec.id);
            removeUrlIndexById(rec.id);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  emitInspectionCacheChanged();
}

export async function clearCachedInspections(): Promise<void> {
  memoryById.clear();
  memoryUrlIndex.clear();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(URL_INDEX_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  const db = await openCacheDb();
  if (!db) {
    emitInspectionCacheChanged();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  emitInspectionCacheChanged();
}
