import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOOKMARKS_CHANGED_EVENT,
  clearAllBookmarks,
  exportBookmarksJson,
  importBookmarksJson,
  loadBookmarks,
  normalizeBookmarkUrl,
  removeBookmarkById,
  toggleResourceBookmark,
} from '../services/bookmark-service';
import type { BookmarkImportResult, MediaBookmark } from '../types/bookmark';
import type { ResourceRecord } from '../types/inspection';

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<MediaBookmark[]>(
    () => loadBookmarks().bookmarks,
  );
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const initial = loadBookmarks();
    setBookmarks(initial.bookmarks);
    setStorageError(initial.error ?? null);

    const handleStorage = () => {
      const refreshed = loadBookmarks();
      setBookmarks(refreshed.bookmarks);
      setStorageError(refreshed.error ?? null);
    };

    const handleInTabChange = (event: Event) => {
      const detail = (event as CustomEvent<MediaBookmark[]>).detail;
      if (Array.isArray(detail)) {
        setBookmarks(detail);
      } else {
        setBookmarks(loadBookmarks().bookmarks);
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(BOOKMARKS_CHANGED_EVENT, handleInTabChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(BOOKMARKS_CHANGED_EVENT, handleInTabChange);
    };
  }, []);

  const bookmarkedUrlSet = useMemo(
    () => new Set(bookmarks.map((item) => item.url)),
    [bookmarks],
  );

  const isBookmarked = useCallback(
    (rawUrl: string): boolean => {
      const normalized = normalizeBookmarkUrl(rawUrl);
      if (!normalized.ok) return false;
      return bookmarkedUrlSet.has(normalized.url);
    },
    [bookmarkedUrlSet],
  );

  const toggleResource = useCallback(
    (resource: ResourceRecord, sourcePageUrl?: string) => {
      const result = toggleResourceBookmark(resource, sourcePageUrl);
      setBookmarks(result.bookmarks);
      setStorageError(result.error ?? null);
      return result;
    },
    [],
  );

  const removeBookmark = useCallback((id: string) => {
    const result = removeBookmarkById(id);
    setBookmarks(result.bookmarks);
    setStorageError(result.error ?? null);
  }, []);

  const clearAll = useCallback(() => {
    const result = clearAllBookmarks();
    setBookmarks(result.bookmarks);
    setStorageError(result.error ?? null);
  }, []);

  const exportJson = useCallback(
    () => exportBookmarksJson(bookmarks),
    [bookmarks],
  );

  const importJson = useCallback((jsonText: string): BookmarkImportResult => {
    const result = importBookmarksJson(jsonText);
    setBookmarks(result.bookmarks);
    setStorageError(result.error ?? null);
    return result;
  }, []);

  return {
    bookmarks,
    storageError,
    isBookmarked,
    toggleResource,
    removeBookmark,
    clearAll,
    exportJson,
    importJson,
  };
}
