import type { InspectionResult, ResourceRecord } from '../../../types/inspection';
import type { AssetFormatToken } from '../../../utils/search-config';
import type { AssetKindFilter } from '../aset/asset-filters';
import type { CollectFrameOptions } from '../web/collect-frame-sources';
import {
  buildPreservedResultsRoutePath,
  buildResultsRoutePath,
  type ResultsTabKey,
} from './results-navigation';

export interface ResultsAssetFilterState {
  jenis?: AssetKindFilter;
  fmt?: AssetFormatToken[];
  q?: string;
}

export interface ResultsRouteState {
  inspectionId?: string;
  canonicalUrl?: string;
  fromWeb?: boolean;
  enabledTargets?: ResultsTabKey[];
  assetFilters?: ResultsAssetFilterState;
}

export function shouldCollectLiveRuntimeAssets(
  result: InspectionResult | null,
): boolean {
  if (!result || result.preview.mode !== 'embeddable') return false;
  const ct = (result.page.contentType ?? '').toLowerCase();
  if (!ct) return true;
  return ct.includes('html') || ct.includes('xhtml');
}

export async function collectRuntimeAndCapturedAssets(params: {
  sessionId: string;
  waitForSources?: (options?: CollectFrameOptions) => Promise<ResourceRecord[]>;
  fetchCaptured: (sessionId: string) => Promise<ResourceRecord[]>;
  options?: CollectFrameOptions;
  isCancelled?: () => boolean;
  timeoutMs?: number;
}): Promise<ResourceRecord[]> {
  const {
    sessionId,
    waitForSources,
    fetchCaptured,
    options,
    isCancelled,
    timeoutMs = 9500,
  } = params;
  const collected: ResourceRecord[] = [];
  const deadline = new Promise<void>((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

  const work = (async () => {
    const [domResources, serverCaptured] = await Promise.all([
      waitForSources ? waitForSources(options) : Promise.resolve([]),
      fetchCaptured(sessionId),
    ]);
    if (isCancelled?.()) return;
    collected.push(...serverCaptured, ...domResources);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 250);
    });
    if (isCancelled?.()) return;
    const lateCaptured = await fetchCaptured(sessionId);
    if (!isCancelled?.() && lateCaptured.length > 0) {
      collected.unshift(...lateCaptured);
    }
  })();

  await Promise.race([work, deadline]);
  return collected;
}

export function resolveCanReturnToWeb(params: {
  bulkId: string | null;
  activeTab: ResultsTabKey;
  routeState: ResultsRouteState | null;
}): boolean {
  const { bulkId, activeTab, routeState } = params;
  return Boolean(
    !bulkId &&
      (activeTab === 'web' ||
        routeState?.fromWeb ||
        routeState?.enabledTargets?.includes('web')),
  );
}

export function buildTabNavigationTarget(params: {
  nextTab: ResultsTabKey;
  currentTab: ResultsTabKey;
  targetUrl?: string | null;
  targetId?: string | null;
  currentState: ResultsRouteState | null;
}): { path: string; state: ResultsRouteState } {
  const { nextTab, currentTab, targetUrl, targetId, currentState } = params;
  const hasWebOrigin =
    nextTab === 'web' ||
    currentTab === 'web' ||
    Boolean(currentState?.fromWeb) ||
    Boolean(currentState?.enabledTargets?.includes('web'));
  const savedAssetFilters = currentState?.assetFilters;
  const path =
    nextTab === 'aset' && savedAssetFilters
      ? buildResultsRoutePath('aset', {
          url: targetUrl,
          jenis: savedAssetFilters.jenis,
          fmt: savedAssetFilters.fmt,
          q: savedAssetFilters.q,
        })
      : buildResultsRoutePath(nextTab, { url: targetUrl });

  return {
    path,
    state: {
      inspectionId: targetId ?? undefined,
      canonicalUrl: targetUrl ?? undefined,
      fromWeb: hasWebOrigin,
      enabledTargets: currentState?.enabledTargets,
      assetFilters: savedAssetFilters,
    },
  };
}

export function buildPreservedTabTarget(params: {
  currentTab: ResultsTabKey;
  destinationUrl: string;
  id: string;
  search: string;
  currentState: ResultsRouteState | null;
}): { path: string; state: ResultsRouteState } {
  const { currentTab, destinationUrl, id, search, currentState } = params;
  return {
    path: buildPreservedResultsRoutePath(currentTab, destinationUrl, search),
    state: {
      inspectionId: id,
      canonicalUrl: destinationUrl,
      fromWeb:
        currentTab === 'web' ||
        Boolean(currentState?.fromWeb) ||
        Boolean(currentState?.enabledTargets?.includes('web')),
      enabledTargets: currentState?.enabledTargets,
      assetFilters: currentState?.assetFilters,
    },
  };
}
