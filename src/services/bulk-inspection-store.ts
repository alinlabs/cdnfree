import { loadSettings } from './settings-service';
import {
  getCachedInspectionById,
  getCachedInspectionByUrl,
  saveCachedInspection,
} from './inspection-cache';
import {
  getInspectionById,
  submitInspectionRequest,
} from './inspection-service';
import type { InspectionError, InspectionResult } from '../types/inspection';

export type BulkSiteStatus = 'pending' | 'loading' | 'success' | 'error';

export interface BulkSiteRecord {
  url: string;
  status: BulkSiteStatus;
  inspectionId?: string;
  result?: InspectionResult;
  errorMessage?: string;
}

export interface BulkInspectionSession {
  id: string;
  submittedUrls: string[];
  createdAt: string;
  items: Record<string, BulkSiteRecord>;
}

interface StoredBulkSession {
  id: string;
  submittedUrls: string[];
  createdAt: string;
  inspectionIds: Record<string, string>;
  errors: Record<string, string>;
}

const BULK_STORAGE_KEY = 'cdnfree:bulk-sessions';
const BULK_PERSISTENT_STORAGE_KEY = 'cdnfree:bulk-sessions:v1';
const MAX_STORED_SESSIONS = 50;
const BULK_CONCURRENCY = 4;
const BULK_TRANSIENT_RETRIES = 2;

export function isRetryableBulkError(error: InspectionError): boolean {
  if (error.code === 'NETWORK_ERROR' || error.code === 'BACKEND_UNAVAILABLE') {
    return true;
  }
  if (error.code !== 'SERVER_ERROR') {
    return false;
  }
  return !/tidak didukung|pengalihan berulang|ukuran halaman melebihi/i.test(
    error.message,
  );
}

const memorySessions = new Map<string, BulkInspectionSession>();
const activeRunners = new Map<string, Promise<void>>();
const sessionListeners = new Map<string, Set<() => void>>();

function notifySession(id: string): void {
  const listeners = sessionListeners.get(id);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

function generateShortBulkId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function readStoredList(storage: Storage | undefined): StoredBulkSession[] {
  if (!storage) return [];
  try {
    const raw =
      storage.getItem(BULK_PERSISTENT_STORAGE_KEY) ??
      storage.getItem(BULK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is StoredBulkSession =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as StoredBulkSession).id === 'string' &&
            Array.isArray((entry as StoredBulkSession).submittedUrls),
        )
      : [];
  } catch {
    return [];
  }
}

function serializeSession(session: BulkInspectionSession): StoredBulkSession {
  const inspectionIds: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const [url, item] of Object.entries(session.items)) {
    if (item.inspectionId) {
      inspectionIds[url] = item.inspectionId;
    }
    if (item.errorMessage) {
      errors[url] = item.errorMessage;
    }
  }
  return {
    id: session.id,
    submittedUrls: session.submittedUrls,
    createdAt: session.createdAt,
    inspectionIds,
    errors,
  };
}

function persistSessionsToStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const existingLocal = readStoredList(window.localStorage);
    const mergedMap = new Map<string, StoredBulkSession>();
    for (const item of existingLocal) {
      mergedMap.set(item.id, item);
    }
    for (const session of memorySessions.values()) {
      mergedMap.set(session.id, serializeSession(session));
    }
    const serializable = Array.from(mergedMap.values()).slice(-MAX_STORED_SESSIONS);
    const payload = JSON.stringify(serializable);
    try {
      window.localStorage.setItem(BULK_PERSISTENT_STORAGE_KEY, payload);
    } catch {
      // Ignore localStorage quota errors
    }
    try {
      window.sessionStorage.setItem(BULK_STORAGE_KEY, payload);
    } catch {
      // Ignore sessionStorage quota errors
    }
  } catch {
    // Ignore storage access errors
  }
}

function hydrateStoredSession(match: StoredBulkSession): BulkInspectionSession {
  const items: Record<string, BulkSiteRecord> = {};
  for (const url of match.submittedUrls) {
    const savedId = match.inspectionIds?.[url];
    const savedError = match.errors?.[url];
    items[url] = {
      url,
      status: savedId ? 'pending' : savedError ? 'error' : 'pending',
      inspectionId: savedId,
      errorMessage: savedError,
    };
  }

  const session: BulkInspectionSession = {
    id: match.id,
    submittedUrls: match.submittedUrls,
    createdAt: match.createdAt,
    items,
  };
  memorySessions.set(session.id, session);
  return session;
}

function loadSessionFromStorage(id: string): BulkInspectionSession | null {
  if (typeof window === 'undefined') return null;
  const fromLocal = readStoredList(window.localStorage).find((e) => e.id === id);
  if (fromLocal) {
    return hydrateStoredSession(fromLocal);
  }
  const fromSession = readStoredList(window.sessionStorage).find((e) => e.id === id);
  if (fromSession) {
    return hydrateStoredSession(fromSession);
  }
  return null;
}

export function createBulkInspectionSession(urls: string[]): BulkInspectionSession {
  const id = generateShortBulkId();
  const items: Record<string, BulkSiteRecord> = {};
  for (const url of urls) {
    items[url] = { url, status: 'pending' };
  }

  const session: BulkInspectionSession = {
    id,
    submittedUrls: [...urls],
    createdAt: new Date().toISOString(),
    items,
  };

  if (memorySessions.size >= MAX_STORED_SESSIONS) {
    const oldestKey = memorySessions.keys().next().value;
    if (oldestKey) {
      memorySessions.delete(oldestKey);
    }
  }
  memorySessions.set(id, session);
  persistSessionsToStorage();
  return session;
}

export function restoreBulkInspectionSession(
  id: string,
  urls: string[],
  createdAt?: string,
): BulkInspectionSession {
  const existing = getBulkInspectionSession(id);
  if (existing) {
    return existing;
  }

  const items: Record<string, BulkSiteRecord> = {};
  for (const url of urls) {
    items[url] = { url, status: 'pending' };
  }
  const session: BulkInspectionSession = {
    id,
    submittedUrls: [...urls],
    createdAt: createdAt ?? new Date().toISOString(),
    items,
  };
  memorySessions.set(id, session);
  persistSessionsToStorage();
  return session;
}

export function getBulkInspectionSession(
  id: string,
): BulkInspectionSession | null {
  const existing = memorySessions.get(id);
  if (existing) {
    return existing;
  }
  return loadSessionFromStorage(id);
}

export function getAllReferencedBulkInspectionIds(
  excludeSessionId?: string,
): Set<string> {
  const ids = new Set<string>();
  if (typeof window !== 'undefined') {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const session of readStoredList(storage)) {
        if (session.id === excludeSessionId) continue;
        for (const siteId of Object.values(session.inspectionIds ?? {})) {
          if (siteId) ids.add(siteId);
        }
      }
    }
  }
  for (const session of memorySessions.values()) {
    if (session.id === excludeSessionId) continue;
    for (const item of Object.values(session.items)) {
      if (item.inspectionId) ids.add(item.inspectionId);
    }
  }
  return ids;
}

export function removeBulkInspectionSession(id: string): string[] {
  const removedSiteIds = new Set<string>();
  const existing = memorySessions.get(id);
  if (existing) {
    for (const item of Object.values(existing.items)) {
      if (item.inspectionId) removedSiteIds.add(item.inspectionId);
    }
    memorySessions.delete(id);
  }
  activeRunners.delete(id);

  if (typeof window !== 'undefined') {
    for (const [storage, key] of [
      [window.localStorage, BULK_PERSISTENT_STORAGE_KEY],
      [window.sessionStorage, BULK_STORAGE_KEY],
    ] as const) {
      try {
        const list = readStoredList(storage);
        const match = list.find((entry) => entry.id === id);
        if (match) {
          for (const siteId of Object.values(match.inspectionIds ?? {})) {
            if (siteId) removedSiteIds.add(siteId);
          }
          const filtered = list.filter((entry) => entry.id !== id);
          if (filtered.length === 0) {
            storage.removeItem(key);
          } else {
            storage.setItem(key, JSON.stringify(filtered));
          }
        }
      } catch {
        // Ignore storage errors
      }
    }
  }

  return Array.from(removedSiteIds);
}

export function clearAllBulkSessions(): void {
  memorySessions.clear();
  activeRunners.clear();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(BULK_PERSISTENT_STORAGE_KEY);
    } catch {
      // Ignore
    }
    try {
      window.sessionStorage.removeItem(BULK_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function subscribeBulkInspectionSession(
  id: string,
  listener: () => void,
): () => void {
  let set = sessionListeners.get(id);
  if (!set) {
    set = new Set();
    sessionListeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const current = sessionListeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      sessionListeners.delete(id);
    }
  };
}

function updateSessionItem(
  id: string,
  url: string,
  nextItem: BulkSiteRecord,
  shouldPersist: boolean,
): void {
  const current = memorySessions.get(id);
  if (!current) return;
  const nextSession: BulkInspectionSession = {
    ...current,
    items: {
      ...current.items,
      [url]: nextItem,
    },
  };
  memorySessions.set(id, nextSession);
  if (shouldPersist) {
    persistSessionsToStorage();
  }
  notifySession(id);
}

async function runSingleBulkSite(
  sessionId: string,
  url: string,
): Promise<void> {
  const session = getBulkInspectionSession(sessionId);
  const current = session?.items[url];
  if (!session || !current || current.result) return;

  updateSessionItem(
    sessionId,
    url,
    { ...current, status: 'loading', errorMessage: undefined },
    false,
  );

  // 1. Check persistent local IndexedDB / memory cache first for instant reopen
  const localById = current.inspectionId
    ? await getCachedInspectionById(current.inspectionId)
    : null;
  const localHit = localById ?? (await getCachedInspectionByUrl(url));
  if (localHit) {
    updateSessionItem(
      sessionId,
      url,
      {
        url,
        status: 'success',
        inspectionId: localHit.id,
        result: localHit,
      },
      true,
    );
    return;
  }

  // 2. Try server session cache by ID
  if (current.inspectionId) {
    const cached = await getInspectionById(current.inspectionId);
    if (cached.ok) {
      void saveCachedInspection(cached.result);
      updateSessionItem(
        sessionId,
        url,
        {
          url,
          status: 'success',
          inspectionId: cached.result.id,
          result: cached.result,
        },
        true,
      );
      return;
    }
  }

  // 3. Submit fresh inspection request
  const currentSettings = loadSettings().data;
  const requestPayload = {
    url,
    options: {
      includeStaticLinks: false,
      includeResources: true,
      enableFilterMatching: currentSettings.protection.enableFilterMatching,
      warnSuspiciousLinks: currentSettings.protection.warnSuspiciousLinks,
      rejectProtocolDowngrade: currentSettings.protection.rejectProtocolDowngrade,
      allowlistedHosts: currentSettings.allowlistedHosts,
    },
  };

  let outcome = await submitInspectionRequest(requestPayload);
  for (let attempt = 1; !outcome.ok && attempt <= BULK_TRANSIENT_RETRIES; attempt += 1) {
    if (!isRetryableBulkError(outcome.error)) break;
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, attempt === 1 ? 750 : 1800),
    );
    outcome = await submitInspectionRequest(requestPayload);
  }

  if (outcome.ok) {
    void saveCachedInspection(outcome.result);
    updateSessionItem(
      sessionId,
      url,
      {
        url,
        status: 'success',
        inspectionId: outcome.result.id,
        result: outcome.result,
      },
      true,
    );
  } else {
    updateSessionItem(
      sessionId,
      url,
      {
        url,
        status: 'error',
        errorMessage: outcome.error.message,
      },
      true,
    );
  }
}

export function ensureBulkInspectionRunning(
  id: string,
  retryFailedOnly = false,
): Promise<void> {
  let session = getBulkInspectionSession(id);
  if (!session) return Promise.resolve();

  const existingRunner = activeRunners.get(id);
  if (existingRunner && !retryFailedOnly) {
    return existingRunner;
  }

  if (retryFailedOnly) {
    const nextItems = { ...session.items };
    for (const url of session.submittedUrls) {
      if (nextItems[url]?.status === 'error') {
        nextItems[url] = { url, status: 'pending' };
      }
    }
    session = { ...session, items: nextItems };
    memorySessions.set(id, session);
    notifySession(id);
  }

  const queue = session.submittedUrls.filter((url) => {
    const item = session.items[url];
    return (
      item &&
      item.status !== 'success' &&
      (retryFailedOnly ? item.status === 'pending' : item.status !== 'error')
    );
  });

  if (queue.length === 0) {
    return Promise.resolve();
  }

  let cursor = 0;
  const workerCount = Math.min(BULK_CONCURRENCY, queue.length);

  const runner = Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < queue.length) {
        const nextUrl = queue[cursor];
        cursor += 1;
        await runSingleBulkSite(id, nextUrl);
      }
    }),
  )
    .then(() => undefined)
    .finally(() => {
      if (activeRunners.get(id) === runner) {
        activeRunners.delete(id);
      }
    });

  activeRunners.set(id, runner);
  return runner;
}
