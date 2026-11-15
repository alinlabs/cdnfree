import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { downloadResourceAsset } from '../../../services/download-service';
import type { ResourceRecord } from '../../../types/inspection';
import { getAssetFilename } from '../../../utils/asset-explorer';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import {
  buildResultsRoutePath,
  type ResultsTabKey,
} from '../shared/results-navigation';
import {
  filterInspectionResources,
  parseAssetFormatFilters,
  parseAssetKindFilter,
  parseAssetStatusFilter,
  parseMediaFullViewParams,
  type AssetFormatToken,
  type AssetKindFilter,
  type AssetStatusFilter,
  type MediaFullViewQueryState,
} from './asset-filters';

interface UseAssetManagerOptions {
  activeTab: ResultsTabKey;
  targetUrl: string | null;
  bulkId?: string | null;
  resolveInspectionId?: (resource: ResourceRecord) => string;
}

export function useAssetManager(
  inspectionId: string | null,
  resources: ResourceRecord[],
  { activeTab, targetUrl, bulkId, resolveInspectionId }: UseAssetManagerOptions,
) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const batchCancelRef = useRef(false);

  const query = activeTab === 'aset' ? (searchParams.get('q') ?? '') : '';
  const kindFilter: AssetKindFilter =
    activeTab === 'aset' ? parseAssetKindFilter(searchParams.get('jenis')) : 'all';
  const formatFilters: AssetFormatToken[] = useMemo(
    () =>
      activeTab === 'aset'
        ? parseAssetFormatFilters(searchParams.get('fmt'))
        : [],
    [activeTab, searchParams],
  );
  const statusFilter: AssetStatusFilter =
    activeTab === 'aset' ? parseAssetStatusFilter(searchParams.get('status')) : 'all';
  const fullView: MediaFullViewQueryState | null =
    activeTab === 'aset'
      ? parseMediaFullViewParams(searchParams.get('view'), searchParams.get('item'))
      : null;

  const updateAsetUrlParams = useCallback(
    (overrides: {
      q?: string;
      jenis?: AssetKindFilter;
      fmt?: AssetFormatToken[];
      status?: AssetStatusFilter;
      view?: 'image' | 'video' | null;
      item?: string | null;
    }) => {
      if (activeTab !== 'aset') return;

      const nextQ = overrides.q !== undefined ? overrides.q : query;
      const nextJenis = overrides.jenis !== undefined ? overrides.jenis : kindFilter;
      const nextFmt = overrides.fmt !== undefined ? overrides.fmt : formatFilters;
      const nextStatus = overrides.status !== undefined ? overrides.status : statusFilter;
      const nextView =
        overrides.view !== undefined ? overrides.view : (fullView?.kind ?? null);
      const nextItem =
        overrides.item !== undefined ? overrides.item : (fullView?.itemKey ?? null);

      const explicitId = searchParams.get('id');
      const nextPath = buildResultsRoutePath('aset', {
        bulkId: bulkId ?? null,
        url: bulkId
          ? null
          : (targetUrl ?? searchParams.get('ur') ?? searchParams.get('url')),
        id: bulkId ? null : explicitId,
        includeId: !bulkId && Boolean(explicitId),
        q: nextQ,
        jenis: nextJenis,
        fmt: nextFmt,
        status: nextStatus,
        view: nextView,
        item: nextItem,
      });

      navigate(nextPath, {
        replace: true,
        state: location.state,
      });
    },
    [
      activeTab,
      bulkId,
      formatFilters,
      fullView?.itemKey,
      fullView?.kind,
      kindFilter,
      location.state,
      navigate,
      query,
      searchParams,
      statusFilter,
      targetUrl,
    ],
  );

  useEffect(() => {
    batchCancelRef.current = true;
    setBatchDownloading(false);
    setBatchStatus(null);
  }, [inspectionId]);

  useEffect(() => {
    return () => {
      batchCancelRef.current = true;
    };
  }, []);

  const setQuery = useCallback(
    (nextQuery: string) => {
      updateAsetUrlParams({ q: nextQuery });
    },
    [updateAsetUrlParams],
  );

  const setKindFilter = useCallback(
    (nextKind: AssetKindFilter) => {
      updateAsetUrlParams({ jenis: nextKind });
    },
    [updateAsetUrlParams],
  );

  const setFormatFilters = useCallback(
    (nextFormats: AssetFormatToken[]) => {
      updateAsetUrlParams({ fmt: nextFormats });
    },
    [updateAsetUrlParams],
  );

  const setStatusFilter = useCallback(
    (nextStatus: AssetStatusFilter) => {
      updateAsetUrlParams({ status: nextStatus });
    },
    [updateAsetUrlParams],
  );

  const openFullView = useCallback(
    (kind: 'image' | 'video', itemKey: string) => {
      updateAsetUrlParams({ view: kind, item: itemKey });
    },
    [updateAsetUrlParams],
  );

  const changeFullViewItem = useCallback(
    (itemKey: string) => {
      if (!fullView) return;
      updateAsetUrlParams({ view: fullView.kind, item: itemKey });
    },
    [fullView, updateAsetUrlParams],
  );

  const closeFullView = useCallback(() => {
    updateAsetUrlParams({ view: null, item: null });
  }, [updateAsetUrlParams]);

  const filteredResources = useMemo(
    () =>
      filterInspectionResources(
        resources,
        query,
        kindFilter,
        statusFilter,
        formatFilters,
      ),
    [resources, query, kindFilter, statusFilter, formatFilters],
  );

  const downloadableFiltered = useMemo(
    () =>
      filteredResources.filter(
        (item) => getAssetDownloadEligibility(item).eligible,
      ),
    [filteredResources],
  );

  const handleDownloadAll = useCallback(async () => {
    if (!inspectionId || batchDownloading || downloadableFiltered.length === 0) {
      return;
    }

    batchCancelRef.current = false;
    setBatchDownloading(true);
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < downloadableFiltered.length; i += 1) {
      if (batchCancelRef.current) break;
      const item = downloadableFiltered[i];
      const targetSid = resolveInspectionId?.(item) ?? inspectionId;
      setBatchStatus(
        `Mengunduh ${i + 1} dari ${downloadableFiltered.length} aset...`,
      );
      const outcome = await downloadResourceAsset(
        targetSid,
        item,
        getAssetFilename(item.url),
      );
      if (outcome.ok) {
        completed += 1;
      } else {
        failed += 1;
      }
    }

    if (!batchCancelRef.current) {
      setBatchStatus(
        failed > 0
          ? `Unduhan selesai: ${completed} berhasil, ${failed} gagal.`
          : `Berhasil mengunduh ${completed} aset.`,
      );
      setBatchDownloading(false);
    }
  }, [inspectionId, batchDownloading, downloadableFiltered, resolveInspectionId]);

  const handleCancelDownloadAll = useCallback(() => {
    batchCancelRef.current = true;
    setBatchDownloading(false);
    setBatchStatus('Unduhan massal dibatalkan.');
  }, []);

  const resetFilters = useCallback(() => {
    updateAsetUrlParams({ q: '', jenis: 'all', fmt: [], status: 'all' });
  }, [updateAsetUrlParams]);

  return {
    query,
    setQuery,
    kindFilter,
    setKindFilter,
    formatFilters,
    setFormatFilters,
    statusFilter,
    setStatusFilter,
    fullView,
    openFullView,
    changeFullViewItem,
    closeFullView,
    filteredResources,
    downloadableCount: downloadableFiltered.length,
    batchDownloading,
    batchStatus,
    handleDownloadAll,
    handleCancelDownloadAll,
    resetFilters,
  };
}
