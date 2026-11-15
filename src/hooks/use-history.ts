import { useCallback, useEffect, useState } from 'react';
import {
  emitCacheFootprintChanged,
  purgeAllHistoryCaches,
  purgeHistoryEntryCaches,
} from '../services/cache-footprint';
import {
  addHistoryEntry,
  clearHistory,
  loadHistory,
  pruneHistoryByRetention,
  removeHistoryEntry,
} from '../services/history-service';
import { loadSettings } from '../services/settings-service';
import type { HistoryEntry } from '../types/history';

const HISTORY_UPDATED_EVENT = 'cdnfree:history-updated';

function emitHistoryUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT));
  }
  emitCacheFootprintChanged();
}

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory().data);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const retentionDays = loadSettings().data.privacy.historyRetentionDays;
    const before = loadHistory().data;
    const initial =
      retentionDays > 0 ? pruneHistoryByRetention(retentionDays) : { ok: true, data: before };
    if (retentionDays > 0 && initial.data.length < before.length) {
      const keptIds = new Set(initial.data.map((item) => item.id));
      const removed = before.filter((item) => !keptIds.has(item.id));
      void purgeHistoryEntryCaches(removed, initial.data);
    }
    setEntries(initial.data);
    setStorageError(initial.error ?? null);

    const handleSync = () => {
      const refreshed = loadHistory();
      setEntries(refreshed.data);
      setStorageError(refreshed.error ?? null);
    };

    window.addEventListener('storage', handleSync);
    window.addEventListener(HISTORY_UPDATED_EVENT, handleSync);
    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener(HISTORY_UPDATED_EVENT, handleSync);
    };
  }, []);

  const addEntry = useCallback((entry: HistoryEntry) => {
    if (!loadSettings().data.privacy.saveLocalHistory) {
      return;
    }
    const result = addHistoryEntry(entry);
    setEntries(result.data);
    setStorageError(result.error ?? null);
    emitHistoryUpdated();
  }, []);

  const removeEntry = useCallback((id: string) => {
    const before = loadHistory().data;
    const removed = before.filter((item) => item.id === id);
    const result = removeHistoryEntry(id);
    setEntries(result.data);
    setStorageError(result.error ?? null);
    void purgeHistoryEntryCaches(removed, result.data);
    emitHistoryUpdated();
  }, []);

  const pruneByRetention = useCallback((days: number) => {
    const before = loadHistory().data;
    const result = pruneHistoryByRetention(days);
    const keptIds = new Set(result.data.map((item) => item.id));
    const removed = before.filter((item) => !keptIds.has(item.id));
    setEntries(result.data);
    setStorageError(result.error ?? null);
    if (removed.length > 0) {
      void purgeHistoryEntryCaches(removed, result.data);
    }
    emitHistoryUpdated();
  }, []);

  const clearAll = useCallback(() => {
    const result = clearHistory();
    setEntries(result.data);
    setStorageError(result.error ?? null);
    void purgeAllHistoryCaches();
    emitHistoryUpdated();
  }, []);

  return {
    entries,
    storageError,
    addEntry,
    removeEntry,
    pruneByRetention,
    clearAll,
  };
}
