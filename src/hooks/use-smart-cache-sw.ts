import { useCallback, useEffect, useState } from 'react';
import { smartCacheDb, type SmartCacheEntry } from '../services/smart-cache-db';
import {
  clearAllSmartCache,
  deleteSmartCacheArtifacts,
  getSmartCacheStats,
  type SmartCacheStats,
} from '../services/smart-cache-storage';

let swRegisteredOnce = false;

async function registerRootSmartCacheSw(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    // Never touch Scramjet's /p/ worker
    if (existing && existing.scope.endsWith('/p/')) {
      // Proceed to register root /sw.js
    } else if (existing?.active?.scriptURL.endsWith('/sw.js')) {
      return true;
    }

    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return Boolean(reg.active || reg.installing || reg.waiting);
  } catch {
    return false;
  }
}

export function useSmartCacheSwBootstrap(): boolean {
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    void smartCacheDb.init();
    if (swRegisteredOnce) {
      setSwReady(true);
      return;
    }
    swRegisteredOnce = true;
    void registerRootSmartCacheSw().then((ok) => {
      setSwReady(ok);
    });
  }, []);

  return swReady;
}

export function useSmartCacheManager() {
  const [entries, setEntries] = useState<SmartCacheEntry[]>(() =>
    smartCacheDb.listEntriesSync(),
  );
  const [stats, setStats] = useState<SmartCacheStats>({
    totalEntries: 0,
    completeEntries: 0,
    hydratingEntries: 0,
    totalBytes: 0,
    budgetBytes: 1.5 * 1024 * 1024 * 1024,
  });
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  const refresh = useCallback(async () => {
    await smartCacheDb.init();
    setEntries(smartCacheDb.listEntriesSync());
    const nextStats = await getSmartCacheStats();
    setStats(nextStats);
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = smartCacheDb.subscribe(() => {
      void refresh();
    });
    const onSettingsChange = () => {
      void refresh();
    };
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('cdnfree:settings-changed', onSettingsChange);
    window.addEventListener('storage', onSettingsChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsub();
      window.removeEventListener('cdnfree:settings-changed', onSettingsChange);
      window.removeEventListener('storage', onSettingsChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const clearCache = useCallback(async () => {
    await clearAllSmartCache();
    await refresh();
  }, [refresh]);

  const removeEntry = useCallback(
    async (key: string) => {
      await deleteSmartCacheArtifacts(key);
      await refresh();
    },
    [refresh],
  );

  return {
    entries,
    stats,
    isOffline,
    refresh,
    clearCache,
    removeEntry,
  };
}
