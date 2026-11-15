import { useEffect, useState } from 'react';
import { BOOKMARKS_CHANGED_EVENT } from '../services/bookmark-service';
import {
  CACHE_FOOTPRINT_CHANGED_EVENT,
  measureCacheFootprint,
  type CacheFootprintSummary,
} from '../services/cache-footprint';
import { smartCacheDb } from '../services/smart-cache-db';

const EMPTY_FOOTPRINT: CacheFootprintSummary = {
  historyBytes: 0,
  markahBytes: 0,
  totalBytes: 0,
};

export function useCacheFootprint(enabled = true): CacheFootprintSummary {
  const [footprint, setFootprint] = useState<CacheFootprintSummary>(EMPTY_FOOTPRINT);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let requestSeq = 0;
    const refresh = () => {
      const seq = ++requestSeq;
      void measureCacheFootprint().then((next) => {
        if (!cancelled && seq === requestSeq) {
          setFootprint(next);
        }
      });
    };

    refresh();

    const handleChange = () => refresh();
    const unsubSmartCache = smartCacheDb.subscribe(handleChange);
    window.addEventListener(CACHE_FOOTPRINT_CHANGED_EVENT, handleChange);
    window.addEventListener('cdnfree:history-updated', handleChange);
    window.addEventListener(BOOKMARKS_CHANGED_EVENT, handleChange);
    window.addEventListener('storage', handleChange);

    return () => {
      cancelled = true;
      unsubSmartCache();
      window.removeEventListener(CACHE_FOOTPRINT_CHANGED_EVENT, handleChange);
      window.removeEventListener('cdnfree:history-updated', handleChange);
      window.removeEventListener(BOOKMARKS_CHANGED_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, [enabled]);

  return footprint;
}
