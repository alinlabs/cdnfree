import { encodeCleanUrQueryValue } from '../../../utils/clean-url';
import {
  serializeAssetFormatFilters,
  type AssetFormatToken,
} from '../../../utils/search-config';
import {
  parseAssetFormatFilters as parseAsetFormatQuery,
  parseAssetKindFilter as parseAsetKindQuery,
  parseAssetStatusFilter as parseAsetStatusQuery,
  parseMediaFullViewParams as parseAsetFullViewQuery,
  type AssetKindFilter,
  type AssetStatusFilter,
} from '../aset/asset-filters';

export type ResultsTabKey = 'web' | 'detail' | 'aset';

export const RESULTS_TAB_KEYS: readonly ResultsTabKey[] = ['web', 'detail', 'aset'];

export function resolveResultsTabFromPathname(pathname: string): ResultsTabKey | null {
  const normalized =
    pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  if (
    normalized === '/search' ||
    normalized === '/search/web' ||
    normalized === '/hasil-pencarian' ||
    normalized === '/hasil-pencarian/web'
  ) {
    return 'web';
  }
  if (normalized === '/search/detail' || normalized === '/hasil-pencarian/detail') {
    return 'detail';
  }
  if (normalized === '/search/aset' || normalized === '/hasil-pencarian/aset') {
    return 'aset';
  }
  return null;
}

export interface ResultsRouteParams {
  url?: string | null;
  bulkId?: string | null;
  id?: string | null;
  includeId?: boolean;
  q?: string;
  jenis?: AssetKindFilter;
  fmt?: readonly AssetFormatToken[];
  status?: AssetStatusFilter;
  view?: 'image' | 'video' | null;
  item?: string | null;
}

export function buildResultsRoutePath(
  tab: ResultsTabKey,
  params?: ResultsRouteParams,
): string {
  const basePath =
    tab === 'web'
      ? '/search'
      : tab === 'detail'
        ? '/search/detail'
        : '/search/aset';

  const parts: string[] = [];
  if (tab === 'aset' && params?.bulkId) {
    parts.push(`bulk=${encodeURIComponent(params.bulkId)}`);
  } else if (params?.url) {
    parts.push(`ur=${encodeCleanUrQueryValue(params.url)}`);
  }

  if (params?.includeId && params?.id) {
    parts.push(`id=${encodeURIComponent(params.id)}`);
  }

  if (tab === 'aset') {
    if (params?.q && params.q.length > 0) {
      parts.push(`q=${encodeURIComponent(params.q)}`);
    }
    if (params?.jenis && params.jenis !== 'all') {
      parts.push(`jenis=${encodeURIComponent(params.jenis)}`);
    }
    const serializedFormats = params?.fmt
      ? serializeAssetFormatFilters(params.fmt)
      : '';
    if (serializedFormats) {
      parts.push(`fmt=${serializedFormats}`);
    }
    if (params?.status && params.status !== 'all') {
      parts.push(`status=${encodeURIComponent(params.status)}`);
    }
    if ((params?.view === 'image' || params?.view === 'video') && params?.item) {
      parts.push(`view=${encodeURIComponent(params.view)}`);
      parts.push(`item=${encodeURIComponent(params.item)}`);
    }
  }

  return parts.length > 0 ? `${basePath}?${parts.join('&')}` : basePath;
}

export function buildPreservedResultsRoutePath(
  tab: ResultsTabKey,
  destinationUrl: string,
  search: string,
): string {
  if (tab !== 'aset') {
    return buildResultsRoutePath(tab, { url: destinationUrl });
  }
  const params = new URLSearchParams(search);
  const fullView = parseAsetFullViewQuery(
    params.get('view'),
    params.get('item'),
  );
  return buildResultsRoutePath('aset', {
    url: destinationUrl,
    q: params.get('q') ?? undefined,
    jenis: parseAsetKindQuery(params.get('jenis')),
    fmt: parseAsetFormatQuery(params.get('fmt')),
    status: parseAsetStatusQuery(params.get('status')),
    view: fullView?.kind ?? null,
    item: fullView?.itemKey ?? null,
  });
}

export function shouldShowWebBackButton(params: {
  activeTab: ResultsTabKey;
  isBulkMode: boolean;
  canReturnToWeb: boolean;
}): boolean {
  return params.activeTab !== 'web' && !params.isBulkMode && params.canReturnToWeb;
}

