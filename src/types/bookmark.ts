import type { AssetKind } from './inspection.ts';

export type MediaBookmarkKind = 'image' | 'video';

export interface MediaBookmark {
  id: string;
  url: string;
  kind: MediaBookmarkKind;
  assetKind?: AssetKind;
  host: string;
  title?: string;
  mimeType?: string;
  declaredBytes?: number;
  posterUrl?: string;
  sourcePageUrl?: string;
  hlsUrl?: string;
  referer?: string;
  smartCacheKey?: string;
  savedAt: string;
}

export interface BookmarkExportEntry {
  url: string;
  kind: MediaBookmarkKind;
  assetKind?: AssetKind;
  title?: string;
  mimeType?: string;
  declaredBytes?: number;
  posterUrl?: string;
  sourcePageUrl?: string;
  hlsUrl?: string;
  referer?: string;
  smartCacheKey?: string;
  savedAt: string;
}

export interface BookmarkExportPayload {
  version: 1;
  exportedAt: string;
  count: number;
  bookmarks: BookmarkExportEntry[];
}

export interface BookmarkImportResult {
  ok: boolean;
  added: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  bookmarks: MediaBookmark[];
  error?: string;
}
