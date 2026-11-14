import { loadSettings } from './settings-service';
import {
  getInspectionById,
  submitInspectionRequest,
} from './inspection-service';
import type { InspectionResult } from '../types/inspection';

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
const MAX_STORED_SESSIONS = 12;
const BULK_CONCURRENCY = 5;

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

function persistSessionsToStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const serializable: StoredBulkSession[] = Array.from(memorySessions.values())
      .slice(-MAX_STORED_SESSIONS)
      .map((session) => {
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
      });
    window.sessionStorage.setItem(BULK_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

function loadSessionFromStorage(id: string): BulkInspectionSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(BULK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const match = parsed.find(
      (entry): entry is StoredBulkSession =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        (entry as StoredBulkSession).id === id &&
        Array.isArray((entry as StoredBulkSession).submittedUrls),
    );
    if (!match) return null;

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
  } catch {
    return null;
  }
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

export function getBulkInspectionSession(
  id: string,
): BulkInspectionSession | null {
  const existing = memorySessions.get(id);
  if (existing) {
    return existing;
  }
  return loadSessionFromStorage(id);
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

  if (current.inspectionId) {
    const cached = await getInspectionById(current.inspectionId);
    if (cached.ok) {
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

  const currentSettings = loadSettings().data;
  const outcome = await submitInspectionRequest({
    url,
    options: {
      includeStaticLinks: false,
      includeResources: true,
      enableFilterMatching: currentSettings.protection.enableFilterMatching,
      warnSuspiciousLinks: currentSettings.protection.warnSuspiciousLinks,
      rejectProtocolDowngrade: currentSettings.protection.rejectProtocolDowngrade,
      allowlistedHosts: currentSettings.allowlistedHosts,
    },
  });

  if (outcome.ok) {
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
