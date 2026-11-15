import type { HistoryEntry, HistoryStorageSchemaV1 } from '../types/history';
import { redactUrlForDisplay } from '../utils/redact-url';
import { validateExternalNavigationUrl } from '../utils/safe-external-url';
import {
  FORMAT_PRESET_MAP,
  VALID_ASSET_KINDS,
  type AssetFormatToken,
  type ConfigAssetKind,
  type SearchLinkMode,
  type SearchTargetMode,
} from '../utils/search-config-core';

export const HISTORY_STORAGE_KEY = 'cdnfree:history:v1';
export const MAX_HISTORY_ENTRIES = 50;
const MAX_STORED_BULK_URLS = 50;

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

const VALID_TARGETS = new Set<SearchTargetMode>(['web', 'detail', 'aset']);

function sanitizeTargets(value: unknown): SearchTargetMode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const unique: SearchTargetMode[] = [];
  for (const item of value) {
    if (
      typeof item === 'string' &&
      VALID_TARGETS.has(item as SearchTargetMode) &&
      !unique.includes(item as SearchTargetMode)
    ) {
      unique.push(item as SearchTargetMode);
    }
  }
  return unique.length > 0 ? unique : undefined;
}

function sanitizeFormats(value: unknown): AssetFormatToken[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const unique: AssetFormatToken[] = [];
  for (const item of value) {
    if (
      typeof item === 'string' &&
      FORMAT_PRESET_MAP.has(item) &&
      !unique.includes(item as AssetFormatToken)
    ) {
      unique.push(item as AssetFormatToken);
    }
  }
  return unique.length > 0 ? unique : undefined;
}

function sanitizeBulkUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const safeUrls: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const check = validateExternalNavigationUrl(item);
    if (check.safe && check.url) {
      safeUrls.push(redactUrlForDisplay(check.url));
      if (safeUrls.length >= MAX_STORED_BULK_URLS) break;
    }
  }
  return safeUrls.length > 0 ? safeUrls : undefined;
}

function sanitizeRoutePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return undefined;
  return trimmed.slice(0, 600);
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
  const searchMode: SearchLinkMode | undefined =
    entry.searchMode === 'bulk' || entry.searchMode === 'single'
      ? entry.searchMode
      : undefined;
  const targetKind: SearchTargetMode | undefined =
    entry.targetKind && VALID_TARGETS.has(entry.targetKind)
      ? entry.targetKind
      : undefined;
  const enabledTargets = sanitizeTargets(entry.enabledTargets);
  const assetCategory: ConfigAssetKind | undefined =
    entry.assetCategory && VALID_ASSET_KINDS.has(entry.assetCategory)
      ? entry.assetCategory
      : undefined;
  const assetFormats = sanitizeFormats(entry.assetFormats);
  const assetKeyword =
    typeof entry.assetKeyword === 'string' && entry.assetKeyword.trim()
      ? entry.assetKeyword.trim().slice(0, 100)
      : undefined;
  const routePath = sanitizeRoutePath(entry.routePath);
  const bulkUrls = sanitizeBulkUrls(entry.bulkUrls);
  const detectedCategoryLabel =
    typeof entry.detectedCategoryLabel === 'string' &&
    entry.detectedCategoryLabel.trim()
      ? entry.detectedCategoryLabel.trim().slice(0, 40)
      : undefined;

  return {
    id: entry.id,
    url: safeDisplayUrl,
    displayUrl: safeDisplayUrl,
    host: entry.host,
    title: entry.title ? entry.title.slice(0, 140) : undefined,
    inspectedAt: entry.inspectedAt,
    status: entry.status,
    ...(searchMode ? { searchMode } : {}),
    ...(targetKind ? { targetKind } : {}),
    ...(enabledTargets ? { enabledTargets } : {}),
    ...(assetCategory ? { assetCategory } : {}),
    ...(assetFormats ? { assetFormats } : {}),
    ...(assetKeyword ? { assetKeyword } : {}),
    ...(routePath ? { routePath } : {}),
    ...(bulkUrls ? { bulkUrls } : {}),
    ...(detectedCategoryLabel ? { detectedCategoryLabel } : {}),
    ...(typeof entry.totalResourceCount === 'number' &&
    Number.isFinite(entry.totalResourceCount) &&
    entry.totalResourceCount >= 0
      ? { totalResourceCount: entry.totalResourceCount }
      : {}),
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
    if (sanitized.length === 0) {
      storage.removeItem(HISTORY_STORAGE_KEY);
    } else {
      storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload));
    }
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

  const isSameRecord = (item: HistoryEntry) => {
    if (item.id === sanitized.id) return true;
    if (sanitized.searchMode === 'bulk' || item.searchMode === 'bulk') {
      return item.id === sanitized.id;
    }
    return item.url === sanitized.url;
  };

  const existing = current.find(isSameRecord);
  const merged: HistoryEntry = {
    ...existing,
    ...sanitized,
    searchMode: sanitized.searchMode ?? existing?.searchMode,
    targetKind: sanitized.targetKind ?? existing?.targetKind,
    enabledTargets: sanitized.enabledTargets ?? existing?.enabledTargets,
    assetCategory: sanitized.assetCategory ?? existing?.assetCategory,
    assetFormats: sanitized.assetFormats ?? existing?.assetFormats,
    assetKeyword: sanitized.assetKeyword ?? existing?.assetKeyword,
    routePath: sanitized.routePath ?? existing?.routePath,
    bulkUrls: sanitized.bulkUrls ?? existing?.bulkUrls,
    detectedCategoryLabel:
      sanitized.detectedCategoryLabel ?? existing?.detectedCategoryLabel,
    totalResourceCount:
      sanitized.totalResourceCount ?? existing?.totalResourceCount,
  };

  const filtered = current.filter((item) => !isSameRecord(item));
  const next = [merged, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
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
