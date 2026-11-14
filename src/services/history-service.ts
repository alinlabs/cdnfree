import type { HistoryEntry, HistoryStorageSchemaV1 } from '../types/history';
import { redactUrlForDisplay } from '../utils/redact-url';
import { validateExternalNavigationUrl } from '../utils/safe-external-url';

export const HISTORY_STORAGE_KEY = 'cdnfree:history:v1';
export const MAX_HISTORY_ENTRIES = 50;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HistoryOperationResult<T> {
  ok: boolean;
  data: T;
  error?: string;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    typeof item.url !== 'string' ||
    item.url.length === 0 ||
    typeof item.host !== 'string' ||
    item.host.length === 0 ||
    typeof item.inspectedAt !== 'string' ||
    (item.status !== 'completed' && item.status !== 'failed')
  ) {
    return false;
  }

  return validateExternalNavigationUrl(item.url).safe;
}

function sanitizeEntry(entry: HistoryEntry): HistoryEntry {
  const safeDisplayUrl = redactUrlForDisplay(entry.url);
  return {
    id: entry.id,
    url: safeDisplayUrl,
    displayUrl: safeDisplayUrl,
    host: entry.host,
    title: entry.title ? entry.title.slice(0, 140) : undefined,
    inspectedAt: entry.inspectedAt,
    status: entry.status,
  };
}

export function loadHistory(
  storage: StorageLike | null = getDefaultStorage(),
): HistoryOperationResult<HistoryEntry[]> {
  if (!storage) {
    return { ok: true, data: [] };
  }

  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return { ok: true, data: [] };
    }

    const parsed: unknown = JSON.parse(raw);

    // Handle current v1 schema or legacy array format safely
    let rawEntries: unknown[] = [];
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Partial<HistoryStorageSchemaV1>).version === 1 &&
      Array.isArray((parsed as Partial<HistoryStorageSchemaV1>).entries)
    ) {
      rawEntries = (parsed as HistoryStorageSchemaV1).entries;
    } else if (Array.isArray(parsed)) {
      rawEntries = parsed;
    } else {
      return {
        ok: false,
        data: [],
        error: 'Format riwayat lokal tidak dikenali dan direset.',
      };
    }

    const entries = rawEntries
      .filter(isValidHistoryEntry)
      .map(sanitizeEntry)
      .slice(0, MAX_HISTORY_ENTRIES);

    return { ok: true, data: entries };
  } catch {
    return {
      ok: false,
      data: [],
      error: 'Gagal membaca riwayat lokal.',
    };
  }
}

export function persistHistory(
  entries: HistoryEntry[],
  storage: StorageLike | null = getDefaultStorage(),
): HistoryOperationResult<HistoryEntry[]> {
  const sanitized = entries.slice(0, MAX_HISTORY_ENTRIES).map(sanitizeEntry);

  if (!storage) {
    return { ok: true, data: sanitized };
  }

  const payload: HistoryStorageSchemaV1 = {
    version: 1,
    entries: sanitized,
  };

  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload));
    return { ok: true, data: sanitized };
  } catch {
    return {
      ok: false,
      data: sanitized,
      error: 'Penyimpanan lokal penuh atau tidak tersedia. Sebagian riwayat tidak tersimpan.',
    };
  }
}

export function addHistoryEntry(
  entry: HistoryEntry,
  storage: StorageLike | null = getDefaultStorage(),
): HistoryOperationResult<HistoryEntry[]> {
  const current = loadHistory(storage).data;
  const sanitized = sanitizeEntry(entry);
  const filtered = current.filter(
    (item) => item.id !== sanitized.id && item.url !== sanitized.url,
  );
  const next = [sanitized, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
  return persistHistory(next, storage);
}

export function removeHistoryEntry(
  id: string,
  storage: StorageLike | null = getDefaultStorage(),
): HistoryOperationResult<HistoryEntry[]> {
  const current = loadHistory(storage).data;
  const next = current.filter((item) => item.id !== id);
  return persistHistory(next, storage);
}

export function pruneHistoryByRetention(
  retentionDays: number,
  storage: StorageLike | null = getDefaultStorage(),
  nowMs = Date.now(),
): HistoryOperationResult<HistoryEntry[]> {
  const loaded = loadHistory(storage);
  if (retentionDays <= 0) {
    return loaded;
  }

  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const filtered = loaded.data.filter((entry) => {
    const ts = Date.parse(entry.inspectedAt);
    return Number.isNaN(ts) ? true : ts >= cutoffMs;
  });

  if (filtered.length === loaded.data.length) {
    return loaded;
  }

  return persistHistory(filtered, storage);
}

export function clearHistory(
  storage: StorageLike | null = getDefaultStorage(),
): HistoryOperationResult<HistoryEntry[]> {
  if (!storage) {
    return { ok: true, data: [] };
  }

  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
    return { ok: true, data: [] };
  } catch {
    return {
      ok: false,
      data: [],
      error: 'Gagal menghapus riwayat lokal.',
    };
  }
}
