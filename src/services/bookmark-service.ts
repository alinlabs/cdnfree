import type {
  BookmarkExportEntry,
  BookmarkExportPayload,
  BookmarkImportResult,
  MediaBookmark,
  MediaBookmarkKind,
} from '../types/bookmark.ts';
import type { ResourceRecord } from '../types/inspection.ts';
import { getAssetFilename } from '../utils/asset-explorer.ts';
import { isProhibitedHostname } from '../utils/normalize-url.ts';
import { validateExternalNavigationUrl } from '../utils/safe-external-url.ts';
import type { StorageLike } from './history-service.ts';

export const BOOKMARKS_STORAGE_KEY = 'cdnfree:bookmarks:v1';
export const BOOKMARKS_CHANGED_EVENT = 'cdnfree:bookmarks-changed';
export const MAX_BOOKMARKS = 1000;

export interface BookmarksOperationResult {
  ok: boolean;
  bookmarks: MediaBookmark[];
  error?: string;
}

export interface ToggleBookmarkResult extends BookmarksOperationResult {
  bookmarked: boolean;
}

const VIDEO_EXT_PATTERN = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi)(?:$|[?#])/i;
const IMAGE_EXT_PATTERN =
  /\.(jpg|jpeg|png|webp|avif|gif|svg|ico|bmp|jfif)(?:$|[?#])/i;

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isBrowserDefaultStorage(storage: StorageLike | null): boolean {
  if (typeof window === 'undefined' || !storage) return false;
  try {
    return storage === window.localStorage;
  } catch {
    return false;
  }
}

function dispatchBookmarksChanged(bookmarks: MediaBookmark[]): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<MediaBookmark[]>(BOOKMARKS_CHANGED_EVENT, {
        detail: bookmarks,
      }),
    );
  }
}

export function normalizeBookmarkUrl(rawUrl: string): {
  ok: true;
  url: string;
  host: string;
} | { ok: false } {
  const validated = validateExternalNavigationUrl(rawUrl);
  if (!validated.safe || !validated.url || !validated.host) {
    return { ok: false };
  }
  if (isProhibitedHostname(validated.host)) {
    return { ok: false };
  }

  try {
    const parsed = new URL(validated.url);
    parsed.hash = '';
    return {
      ok: true,
      url: parsed.toString(),
      host: parsed.hostname.toLowerCase(),
    };
  } catch {
    return { ok: false };
  }
}

export function buildBookmarkId(canonicalUrl: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonicalUrl.length; i += 1) {
    const code = canonicalUrl.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `bm-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function inferMediaBookmarkKind(
  url: string,
  mimeType?: string,
  explicitKind?: unknown,
): MediaBookmarkKind {
  if (explicitKind === 'video' || explicitKind === 'image') {
    return explicitKind;
  }
  const mime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (VIDEO_EXT_PATTERN.test(url)) return 'video';
  if (IMAGE_EXT_PATTERN.test(url)) return 'image';
  return 'image';
}

function sanitizeOptionalString(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function sanitizePosterUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeBookmarkUrl(value);
  return normalized.ok ? normalized.url : undefined;
}

function sanitizeBookmarkEntry(raw: unknown): MediaBookmark | null {
  if (typeof raw === 'string') {
    const normalized = normalizeBookmarkUrl(raw);
    if (!normalized.ok) return null;
    const kind = inferMediaBookmarkKind(normalized.url);
    return {
      id: buildBookmarkId(normalized.url),
      url: normalized.url,
      kind,
      host: normalized.host,
      title: getAssetFilename(normalized.url),
      savedAt: new Date().toISOString(),
    };
  }

  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawUrl =
    typeof obj.url === 'string'
      ? obj.url
      : typeof obj.link === 'string'
        ? obj.link
        : typeof obj.href === 'string'
          ? obj.href
          : '';
  const normalized = normalizeBookmarkUrl(rawUrl);
  if (!normalized.ok) return null;

  const mimeType = sanitizeOptionalString(obj.mimeType, 120);
  const kind = inferMediaBookmarkKind(normalized.url, mimeType, obj.kind);
  const declaredBytes =
    typeof obj.declaredBytes === 'number' &&
    Number.isFinite(obj.declaredBytes) &&
    obj.declaredBytes >= 0
      ? obj.declaredBytes
      : undefined;
  const savedAtRaw =
    typeof obj.savedAt === 'string' && !Number.isNaN(Date.parse(obj.savedAt))
      ? new Date(obj.savedAt).toISOString()
      : new Date().toISOString();

  return {
    id: buildBookmarkId(normalized.url),
    url: normalized.url,
    kind,
    host: normalized.host,
    title: sanitizeOptionalString(obj.title, 240) ?? getAssetFilename(normalized.url),
    mimeType,
    declaredBytes,
    posterUrl: sanitizePosterUrl(obj.posterUrl),
    sourcePageUrl: sanitizePosterUrl(obj.sourcePageUrl),
    savedAt: savedAtRaw,
  };
}

function sortAndDeduplicateBookmarks(items: MediaBookmark[]): MediaBookmark[] {
  const byUrl = new Map<string, MediaBookmark>();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing || Date.parse(item.savedAt) > Date.parse(existing.savedAt)) {
      byUrl.set(item.url, item);
    }
  }
  return Array.from(byUrl.values())
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, MAX_BOOKMARKS);
}

export function loadBookmarks(
  storage: StorageLike | null = getDefaultStorage(),
): BookmarksOperationResult {
  if (!storage) {
    return { ok: true, bookmarks: [] };
  }

  try {
    const raw = storage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) {
      return { ok: true, bookmarks: [] };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        bookmarks: [],
        error: 'Data markah lokal tidak valid dan dilewati.',
      };
    }

    const sanitized = parsed
      .map((item) => sanitizeBookmarkEntry(item))
      .filter((item): item is MediaBookmark => item !== null);
    return { ok: true, bookmarks: sortAndDeduplicateBookmarks(sanitized) };
  } catch {
    return {
      ok: false,
      bookmarks: [],
      error: 'Gagal membaca data markah lokal dari peramban.',
    };
  }
}

export function saveBookmarks(
  bookmarks: MediaBookmark[],
  storage: StorageLike | null = getDefaultStorage(),
): BookmarksOperationResult {
  const clean = sortAndDeduplicateBookmarks(bookmarks);
  if (!storage) {
    return { ok: true, bookmarks: clean };
  }

  try {
    storage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(clean));
    if (isBrowserDefaultStorage(storage)) {
      dispatchBookmarksChanged(clean);
    }
    return { ok: true, bookmarks: clean };
  } catch {
    return {
      ok: false,
      bookmarks: clean,
      error: 'Penyimpanan lokal penuh. Markah terbaru tidak dapat disimpan.',
    };
  }
}

export function toggleResourceBookmark(
  resource: ResourceRecord,
  sourcePageUrl?: string,
  storage: StorageLike | null = getDefaultStorage(),
): ToggleBookmarkResult {
  const current = loadBookmarks(storage).bookmarks;
  const normalized = normalizeBookmarkUrl(resource.url);
  if (!normalized.ok) {
    return {
      ok: false,
      bookmarks: current,
      bookmarked: false,
      error: 'Tautan media ini tidak memenuhi kebijakan keamanan untuk disimpan ke markah.',
    };
  }

  const alreadyExists = current.some((item) => item.url === normalized.url);
  if (alreadyExists) {
    const next = current.filter((item) => item.url !== normalized.url);
    const saved = saveBookmarks(next, storage);
    return { ...saved, bookmarked: false };
  }

  const kind = inferMediaBookmarkKind(
    normalized.url,
    resource.mimeType,
    resource.kind === 'video' ? 'video' : 'image',
  );

  const entry: MediaBookmark = {
    id: buildBookmarkId(normalized.url),
    url: normalized.url,
    kind,
    host: normalized.host,
    title: getAssetFilename(normalized.url),
    mimeType: resource.mimeType,
    declaredBytes: resource.declaredBytes,
    posterUrl: sanitizePosterUrl(resource.posterUrl),
    sourcePageUrl: sanitizePosterUrl(sourcePageUrl),
    savedAt: new Date().toISOString(),
  };

  const saved = saveBookmarks([entry, ...current], storage);
  return { ...saved, bookmarked: saved.ok };
}

export function removeBookmarkById(
  id: string,
  storage: StorageLike | null = getDefaultStorage(),
): BookmarksOperationResult {
  const current = loadBookmarks(storage).bookmarks;
  const next = current.filter((item) => item.id !== id);
  return saveBookmarks(next, storage);
}

export function clearAllBookmarks(
  storage: StorageLike | null = getDefaultStorage(),
): BookmarksOperationResult {
  if (!storage) {
    return { ok: true, bookmarks: [] };
  }
  try {
    storage.removeItem(BOOKMARKS_STORAGE_KEY);
    if (isBrowserDefaultStorage(storage)) {
      dispatchBookmarksChanged([]);
    }
    return { ok: true, bookmarks: [] };
  } catch {
    return {
      ok: false,
      bookmarks: loadBookmarks(storage).bookmarks,
      error: 'Gagal menghapus seluruh markah lokal.',
    };
  }
}

export function exportBookmarksJson(bookmarks: MediaBookmark[]): string {
  const entries: BookmarkExportEntry[] = bookmarks.map((item) => ({
    url: item.url,
    kind: item.kind,
    ...(item.title ? { title: item.title } : {}),
    ...(item.mimeType ? { mimeType: item.mimeType } : {}),
    ...(typeof item.declaredBytes === 'number'
      ? { declaredBytes: item.declaredBytes }
      : {}),
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
    ...(item.sourcePageUrl ? { sourcePageUrl: item.sourcePageUrl } : {}),
    savedAt: item.savedAt,
  }));

  const payload: BookmarkExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: entries.length,
    bookmarks: entries,
  };

  return JSON.stringify(payload, null, 2);
}

export function importBookmarksJson(
  rawJsonText: string,
  storage: StorageLike | null = getDefaultStorage(),
): BookmarkImportResult {
  const existing = loadBookmarks(storage).bookmarks;
  const trimmed = rawJsonText.trim();
  if (!trimmed) {
    return {
      ok: false,
      added: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      bookmarks: existing,
      error: 'Isi JSON kosong. Pilih berkas JSON atau tempel daftar tautan terlebih dahulu.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      added: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      bookmarks: existing,
      error: 'Format JSON tidak valid. Pastikan sintaks tanda kutip, koma, dan kurung sudah benar.',
    };
  }

  let rawCandidates: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rawCandidates = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.bookmarks)) {
      rawCandidates = obj.bookmarks;
    } else if (Array.isArray(obj.links)) {
      rawCandidates = obj.links;
    } else if (Array.isArray(obj.items)) {
      rawCandidates = obj.items;
    }
  }

  if (!rawCandidates) {
    return {
      ok: false,
      added: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      bookmarks: existing,
      error:
        'Struktur JSON tidak dikenali. Gunakan berkas ekspor CDNFREE atau array tautan JSON.',
    };
  }

  const seenUrls = new Set(existing.map((item) => item.url));
  const newlyAdded: MediaBookmark[] = [];
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const candidate of rawCandidates) {
    const entry = sanitizeBookmarkEntry(candidate);
    if (!entry) {
      skippedInvalid += 1;
      continue;
    }
    if (seenUrls.has(entry.url)) {
      skippedDuplicates += 1;
      continue;
    }
    seenUrls.add(entry.url);
    newlyAdded.push(entry);
  }

  const merged = saveBookmarks([...newlyAdded, ...existing], storage);
  if (!merged.ok) {
    return {
      ok: false,
      added: 0,
      skippedDuplicates,
      skippedInvalid,
      bookmarks: existing,
      error: merged.error,
    };
  }

  return {
    ok: true,
    added: newlyAdded.length,
    skippedDuplicates,
    skippedInvalid,
    bookmarks: merged.bookmarks,
  };
}

export function bookmarkToResourceRecord(
  bookmark: MediaBookmark,
): ResourceRecord {
  return {
    id: bookmark.id,
    url: bookmark.url,
    host: bookmark.host,
    kind: bookmark.kind,
    mimeType: bookmark.mimeType,
    declaredBytes: bookmark.declaredBytes,
    posterUrl: bookmark.posterUrl,
    observation: 'fetched',
    source: bookmark.kind === 'video' ? 'html-video' : 'html-img',
    classification: 'allowed',
    reason: bookmark.sourcePageUrl
      ? `Disimpan dari ${bookmark.sourcePageUrl}`
      : undefined,
  };
}
