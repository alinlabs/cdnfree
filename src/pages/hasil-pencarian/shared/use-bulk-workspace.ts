import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ensureBulkInspectionRunning,
  getBulkInspectionSession,
  subscribeBulkInspectionSession,
  type BulkInspectionSession,
  type BulkSiteStatus,
} from '../../../services/bulk-inspection-store';
import type { ResourceRecord } from '../../../types/inspection';
import { deduplicateResources } from '../../../utils/asset-explorer';
import { getHostnameSafe } from '../../../utils/inspection-details';

export interface BulkSiteEntrySummary {
  url: string;
  host: string;
  status: BulkSiteStatus;
  inspectionId?: string;
  errorMessage?: string;
  assetCount: number;
}

export function useBulkWorkspace(bulkId: string | null) {
  const [session, setSession] = useState<BulkInspectionSession | null>(() =>
    bulkId ? getBulkInspectionSession(bulkId) : null,
  );
  const [siteFilter, setSiteFilter] = useState<string>('all');

  useEffect(() => {
    setSiteFilter('all');
    if (!bulkId) {
      setSession(null);
      return;
    }

    setSession(getBulkInspectionSession(bulkId));
    const unsubscribe = subscribeBulkInspectionSession(bulkId, () => {
      setSession(getBulkInspectionSession(bulkId));
    });
    void ensureBulkInspectionRunning(bulkId);
    return unsubscribe;
  }, [bulkId]);

  const siteEntries: BulkSiteEntrySummary[] = useMemo(() => {
    if (!session) return [];
    return session.submittedUrls.map((url) => {
      const record = session.items[url];
      const finalUrl = record?.result?.finalUrl || url;
      return {
        url,
        host: getHostnameSafe(finalUrl) || url,
        status: record?.status ?? 'pending',
        inspectionId: record?.inspectionId,
        errorMessage: record?.errorMessage,
        assetCount: record?.result?.resources.length ?? 0,
      };
    });
  }, [session]);

  const { mergedResources, sourceInspectionMap } = useMemo(() => {
    const map = new Map<string, string>();
    if (!session) {
      return { mergedResources: [] as ResourceRecord[], sourceInspectionMap: map };
    }

    const raw: ResourceRecord[] = [];
    for (const url of session.submittedUrls) {
      if (siteFilter !== 'all' && url !== siteFilter) continue;
      const item = session.items[url];
      if (!item?.result) continue;
      const sid = item.result.id;
      for (const resource of item.result.resources) {
        const key = `${resource.id}::${resource.url}`;
        if (!map.has(key)) {
          map.set(key, sid);
        }
        raw.push(resource);
      }
    }

    return {
      mergedResources: deduplicateResources(raw),
      sourceInspectionMap: map,
    };
  }, [session, siteFilter]);

  const allSiteTotalAssetCount = useMemo(() => {
    if (!session) return 0;
    const raw: ResourceRecord[] = [];
    for (const url of session.submittedUrls) {
      const item = session.items[url];
      if (item?.result) {
        raw.push(...item.result.resources);
      }
    }
    return deduplicateResources(raw).length;
  }, [session]);

  const resolveInspectionId = useCallback(
    (resource: ResourceRecord): string => {
      const exact = sourceInspectionMap.get(`${resource.id}::${resource.url}`);
      if (exact) return exact;
      if (session) {
        for (const url of session.submittedUrls) {
          const sid = session.items[url]?.result?.id;
          if (sid) return sid;
        }
      }
      return '';
    },
    [session, sourceInspectionMap],
  );

  const completedCount = siteEntries.filter((entry) => entry.status === 'success').length;
  const failedCount = siteEntries.filter((entry) => entry.status === 'error').length;
  const finishedCount = completedCount + failedCount;
  const totalSiteCount = siteEntries.length;
  const isRunning = siteEntries.some(
    (entry) => entry.status === 'pending' || entry.status === 'loading',
  );

  const retryFailed = useCallback(() => {
    if (!bulkId) return;
    void ensureBulkInspectionRunning(bulkId, true);
  }, [bulkId]);

  const refreshBulk = useCallback(() => {
    if (!bulkId) return;
    if (failedCount > 0) {
      void ensureBulkInspectionRunning(bulkId, true);
    } else {
      void ensureBulkInspectionRunning(bulkId, false);
    }
  }, [bulkId, failedCount]);

  return {
    isBulkMode: Boolean(bulkId),
    isBulkMissing: Boolean(bulkId && !session),
    session,
    siteEntries,
    siteFilter,
    setSiteFilter,
    mergedResources,
    allSiteTotalAssetCount,
    resolveInspectionId,
    completedCount,
    failedCount,
    finishedCount,
    totalSiteCount,
    isRunning,
    retryFailed,
    refreshBulk,
  };
}
