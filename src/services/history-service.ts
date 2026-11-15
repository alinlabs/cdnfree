import type { HistoryEntry, HistoryStorageSchemaV1 } from '../types/history';
import type { ResourceRecord } from '../types/inspection';
import {
  classifyAssetGroup,
  deduplicateResources,
  isPlayableVideoCandidate,
  isSvgResource,
} from '../utils/asset-explorer';
import { redactUrlForDisplay } from '../utils/redact-url';
import { validateExternalNavigationUrl } from '../utils/safe-external-url';

export const HISTORY_STORAGE_KEY = 'cdnfree:history:v1';
export const MAX_HISTORY_ENTRIES = 50;
export const MAX_HISTORY_PREVIEW_IMAGES = 12;
export const MAX_HISTORY_PREVIEW_VIDEOS = 6;

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

const VALID_KINDS = new Set<ResourceRecord['kind']>([
  'image',
  'video',
  'audio',
  'script',
  'stylesheet',
  'font',
  'document',
  'other',
]);

const VALID_CLASSIFICATIONS = new Set<ResourceRecord['classification']>([
  'allowed',
  'ad-or-tracker',
  'suspicious',
  'known-malicious',
  'unknown',
]);

const VALID_SOURCES = new Set<ResourceRecord['source']>([
  'html-img',
  'html-video',
  'html-audio',
  'html-script',
  'html-link',
  'html-source',
  'css-reference',
  'browser-observed',
]);

const VALID_OBSERVATIONS = new Set<ResourceRecord['observation']>([
  'discovered',
  'fetched',
  'blocked',
  'unknown',
]);

function sanitizePreviewResource(value: unknown): ResourceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    typeof item.url !== 'string' ||
    item.url.length === 0 ||
    typeof item.host !== 'string' ||
    item.host.length === 0
  ) {
    return null;
  }

  const urlCheck = validateExternalNavigationUrl(item.url);
  if (!urlCheck.safe || !urlCheck.url) {
    return null;
  }

  let safePoster: string | undefined;
  if (typeof item.posterUrl === 'string' && item.posterUrl.trim()) {
    const posterCheck = validateExternalNavigationUrl(item.posterUrl);
    if (posterCheck.safe && posterCheck.url) {
      safePoster = posterCheck.url;
    }
  }

  const kind: ResourceRecord['kind'] =
    typeof item.kind === 'string' &&
    VALID_KINDS.has(item.kind as ResourceRecord['kind'])
      ? (item.kind as ResourceRecord['kind'])
      : 'other';

  const classification: ResourceRecord['classification'] =
    typeof item.classification === 'string' &&
    VALID_CLASSIFICATIONS.has(item.classification as ResourceRecord['classification'])
      ? (item.classification as ResourceRecord['classification'])
      : 'unknown';

  const source: ResourceRecord['source'] =
    typeof item.source === 'string' &&
    VALID_SOURCES.has(item.source as ResourceRecord['source'])
      ? (item.source as ResourceRecord['source'])
      : 'html-img';
  const observation: ResourceRecord['observation'] =
    typeof item.observation === 'string' &&
    VALID_OBSERVATIONS.has(item.observation as ResourceRecord['observation'])
      ? (item.observation as ResourceRecord['observation'])
      : 'discovered';

  return {
    id: item.id.slice(0, 120),
    url: urlCheck.url,
    host: item.host.slice(0, 255),
    kind,
    mimeType:
      typeof item.mimeType === 'string' && item.mimeType
        ? item.mimeType.slice(0, 100)
        : undefined,
    declaredBytes:
      typeof item.declaredBytes === 'number' &&
      Number.isFinite(item.declaredBytes) &&
      item.declaredBytes >= 0
        ? item.declaredBytes
        : undefined,
    posterUrl: safePoster,
    source,
    observation,
    classification,
  };
}

export function selectHistoryPreviewResources(
  resources: ResourceRecord[],
): ResourceRecord[] {
  const deduped = deduplicateResources(resources);
  const scored = deduped.filter((item) => {
    if (item.classification === 'known-malicious') return false;
    if (isSvgResource(item)) return true;
    const group = classifyAssetGroup(item);
    if (group === 'image') return true;
    if (group === 'video' && isPlayableVideoCandidate(item)) return true;
    return false;
  });

  scored.sort((a, b) => {
    const aUnverified = a.observation !== 'fetched' && !a.mimeType ? 1 : 0;
    const bUnverified = b.observation !== 'fetched' && !b.mimeType ? 1 : 0;
    if (aUnverified !== bUnverified) return aUnverified - bUnverified;
    return (b.declaredBytes ?? 0) - (a.declaredBytes ?? 0);
  });

  const selectedImages: ResourceRecord[] = [];
  const selectedVideos: ResourceRecord[] = [];

  for (const item of scored) {
    const sanitized = sanitizePreviewResource(item);
    if (!sanitized) continue;
    const isVideo =
      !isSvgResource(sanitized) && classifyAssetGroup(sanitized) === 'video';
    if (isVideo) {
      if (selectedVideos.length < MAX_HISTORY_PREVIEW_VIDEOS) {
        selectedVideos.push(sanitized);
      }
    } else if (selectedImages.length < MAX_HISTORY_PREVIEW_IMAGES) {
      selectedImages.push(sanitized);
    }
    if (
      selectedImages.length >= MAX_HISTORY_PREVIEW_IMAGES &&
      selectedVideos.length >= MAX_HISTORY_PREVIEW_VIDEOS
    ) {
      break;
    }
  }

  return [...selectedImages, ...selectedVideos];
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
  const previewResources = Array.isArray(entry.previewResources)
    ? entry.previewResources
        .map(sanitizePreviewResource)
        .filter((item): item is ResourceRecord => item !== null)
        .slice(0, MAX_HISTORY_PREVIEW_IMAGES + MAX_HISTORY_PREVIEW_VIDEOS)
    : undefined;

  return {
    id: entry.id,
    url: safeDisplayUrl,
    displayUrl: safeDisplayUrl,
    host: entry.host,
    title: entry.title ? entry.title.slice(0, 140) : undefined,
    inspectedAt: entry.inspectedAt,
    status: entry.status,
    ...(previewResources && previewResources.length > 0
      ? { previewResources }
      : {}),
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

  const writeAttempt = (candidateEntries: HistoryEntry[]): boolean => {
    const payload: HistoryStorageSchemaV1 = {
      version: 1,
      entries: candidateEntries,
    };
    try {
      storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  if (writeAttempt(sanitized)) {
    return { ok: true, data: sanitized };
  }

  const trimmedOldPreviews = sanitized.map((entry, idx) =>
    idx < 8 ? entry : { ...entry, previewResources: undefined },
  );
  if (writeAttempt(trimmedOldPreviews)) {
    return { ok: true, data: trimmedOldPreviews };
  }

  const strippedPreviews = sanitized.map((entry) => ({
    ...entry,
    previewResources: undefined,
  }));
  if (writeAttempt(strippedPreviews)) {
    return { ok: true, data: strippedPreviews };
  }

  return {
    ok: false,
    data: sanitized,
    error: 'Penyimpanan lokal penuh atau tidak tersedia. Sebagian riwayat tidak tersimpan.',
  };
}

export function addHistoryEntry(
  entry: HistoryEntry,
  storage: StorageLike | null = getDefaultStorage(),
): HistoryOperationResult<HistoryEntry[]> {
  const current = loadHistory(storage).data;
  const sanitized = sanitizeEntry(entry);
  const existing = current.find(
    (item) => item.id === sanitized.id || item.url === sanitized.url,
  );
  const merged: HistoryEntry = {
    ...sanitized,
    previewResources:
      sanitized.previewResources && sanitized.previewResources.length > 0
        ? sanitized.previewResources
        : existing?.previewResources,
    totalResourceCount:
      sanitized.totalResourceCount ?? existing?.totalResourceCount,
  };
  const filtered = current.filter(
    (item) => item.id !== sanitized.id && item.url !== sanitized.url,
  );
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
