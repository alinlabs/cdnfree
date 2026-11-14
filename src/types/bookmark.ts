export type MediaBookmarkKind = 'image' | 'video';

export interface MediaBookmark {
  id: string;
  url: string;
  kind: MediaBookmarkKind;
  host: string;
  title?: string;
  mimeType?: string;
  declaredBytes?: number;
  posterUrl?: string;
  sourcePageUrl?: string;
  savedAt: string;
}

export interface BookmarkExportEntry {
  url: string;
  kind: MediaBookmarkKind;
  title?: string;
  mimeType?: string;
  declaredBytes?: number;
  posterUrl?: string;
  sourcePageUrl?: string;
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
