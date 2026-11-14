import { useCallback, useEffect, useState } from 'react';
import {
  addHistoryEntry,
  clearHistory,
  loadHistory,
  pruneHistoryByRetention,
  removeHistoryEntry,
} from '../services/history-service';
import { loadSettings } from '../services/settings-service';
import type { HistoryEntry } from '../types/history';

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory().data);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const retentionDays = loadSettings().data.privacy.historyRetentionDays;
    const initial =
      retentionDays > 0 ? pruneHistoryByRetention(retentionDays) : loadHistory();
    setEntries(initial.data);
    setStorageError(initial.error ?? null);

    const handleStorage = () => {
      const refreshed = loadHistory();
      setEntries(refreshed.data);
      setStorageError(refreshed.error ?? null);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const addEntry = useCallback((entry: HistoryEntry) => {
    if (!loadSettings().data.privacy.saveLocalHistory) {
      return;
    }
    const result = addHistoryEntry(entry);
    setEntries(result.data);
    setStorageError(result.error ?? null);
  }, []);

  const removeEntry = useCallback((id: string) => {
    const result = removeHistoryEntry(id);
    setEntries(result.data);
    setStorageError(result.error ?? null);
  }, []);

  const pruneByRetention = useCallback((days: number) => {
    const result = pruneHistoryByRetention(days);
    setEntries(result.data);
    setStorageError(result.error ?? null);
  }, []);

  const clearAll = useCallback(() => {
    const result = clearHistory();
    setEntries(result.data);
    setStorageError(result.error ?? null);
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
