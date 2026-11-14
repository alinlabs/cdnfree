import type { ResourceRecord } from '../../../types/inspection';
import {
  classifyAssetGroup,
  getAssetFilename,
  isPdfResource,
} from '../../../utils/asset-explorer';
import {
  ASSET_FORMAT_PRESETS,
  matchesAssetFormatFilter,
  parseAssetFormatFilters,
  serializeAssetFormatFilters,
  type AssetFormatToken,
} from '../../../utils/search-config';

export {
  ASSET_FORMAT_PRESETS,
  matchesAssetFormatFilter,
  parseAssetFormatFilters,
  serializeAssetFormatFilters,
  type AssetFormatToken,
};

export type AssetKindFilter = 'all' | ResourceRecord['kind'];
export type AssetStatusFilter =
  | 'all'
  | 'allowed'
  | 'ad-or-tracker'
  | 'suspicious'
  | 'unknown';

export const ASSET_KIND_OPTIONS: Array<{ value: AssetKindFilter; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'image', label: 'Gambar' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'script', label: 'Script' },
  { value: 'stylesheet', label: 'Stylesheet' },
  { value: 'font', label: 'Font' },
  { value: 'document', label: 'Dokumen' },
  { value: 'other', label: 'Lainnya' },
];

export const ASSET_STATUS_OPTIONS: Array<{ value: AssetStatusFilter; label: string }> = [
  { value: 'all', label: 'Semua status' },
  { value: 'allowed', label: 'Diizinkan' },
  { value: 'ad-or-tracker', label: 'Iklan / pelacak' },
  { value: 'suspicious', label: 'Perlu ditinjau' },
  { value: 'unknown', label: 'Tidak diketahui' },
];

export const ASSET_KIND_LABELS: Record<ResourceRecord['kind'], string> = {
  image: 'Gambar',
  video: 'Video',
  audio: 'Audio',
  script: 'Script',
  stylesheet: 'Stylesheet',
  font: 'Font',
  document: 'Dokumen',
  other: 'Lainnya',
};

const VALID_ASSET_KINDS = new Set<string>(ASSET_KIND_OPTIONS.map((opt) => opt.value));
const VALID_ASSET_STATUSES = new Set<string>(
  ASSET_STATUS_OPTIONS.map((opt) => opt.value),
);

export function parseAssetKindFilter(raw: string | null): AssetKindFilter {
  if (raw && VALID_ASSET_KINDS.has(raw)) {
    return raw as AssetKindFilter;
  }
  return 'all';
}

export function parseAssetStatusFilter(raw: string | null): AssetStatusFilter {
  if (raw && VALID_ASSET_STATUSES.has(raw)) {
    return raw as AssetStatusFilter;
  }
  return 'all';
}

export interface MediaFullViewQueryState {
  kind: 'image' | 'video';
  itemKey: string;
}

export function parseMediaFullViewParams(
  viewParam: string | null,
  itemParam: string | null,
): MediaFullViewQueryState | null {
  if (viewParam !== 'image' && viewParam !== 'video') {
    return null;
  }
  const trimmedItem = itemParam?.trim();
  if (!trimmedItem) {
    return null;
  }
  return {
    kind: viewParam,
    itemKey: trimmedItem,
  };
}

export function resolveFullViewIndex(
  items: ResourceRecord[],
  itemKey: string,
): number {
  if (items.length === 0) return -1;

  const byId = items.findIndex((item) => item.id === itemKey);
  if (byId !== -1) return byId;

  const byFilename = items.findIndex((item) => getAssetFilename(item.url) === itemKey);
  if (byFilename !== -1) return byFilename;

  if (/^\d+$/.test(itemKey)) {
    const oneBased = Number(itemKey);
    if (oneBased >= 1 && oneBased <= items.length) {
      return oneBased - 1;
    }
  }

  return 0;
}

export interface PartitionedAssets {
  imageAssets: ResourceRecord[];
  videoAssets: ResourceRecord[];
  pdfAssets: ResourceRecord[];
  otherAssets: ResourceRecord[];
}

export function filterInspectionResources(
  resources: ResourceRecord[],
  query: string,
  kindFilter: AssetKindFilter,
  statusFilter: AssetStatusFilter,
  formatFilters: readonly AssetFormatToken[] = [],
): ResourceRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  return resources.filter((resource) => {
    if (kindFilter !== 'all' && resource.kind !== kindFilter) {
      return false;
    }

    if (formatFilters.length > 0 && !matchesAssetFormatFilter(resource, formatFilters)) {
      return false;
    }

    if (statusFilter === 'suspicious') {
      if (
        resource.classification !== 'suspicious' &&
        resource.classification !== 'known-malicious'
      ) {
        return false;
      }
    } else if (statusFilter !== 'all' && resource.classification !== statusFilter) {
      return false;
    }

    if (!normalizedQuery) return true;
    return (
      resource.url.toLowerCase().includes(normalizedQuery) ||
      resource.host.toLowerCase().includes(normalizedQuery) ||
      resource.kind.toLowerCase().includes(normalizedQuery) ||
      (resource.mimeType ?? '').toLowerCase().includes(normalizedQuery)
    );
  });
}

export function partitionAssetsByCategory(
  resources: ResourceRecord[],
): PartitionedAssets {
  const imageAssets: ResourceRecord[] = [];
  const videoAssets: ResourceRecord[] = [];
  const pdfAssets: ResourceRecord[] = [];
  const otherAssets: ResourceRecord[] = [];

  for (const item of resources) {
    const group = classifyAssetGroup(item);
    if (group === 'image') {
      imageAssets.push(item);
    } else if (group === 'video') {
      videoAssets.push(item);
    } else if (isPdfResource(item)) {
      pdfAssets.push(item);
    } else {
      otherAssets.push(item);
    }
  }

  return {
    imageAssets,
    videoAssets,
    pdfAssets,
    otherAssets,
  };
}
