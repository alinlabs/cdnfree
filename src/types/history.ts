import type {
  AssetFormatToken,
  ConfigAssetKind,
  SearchLinkMode,
  SearchTargetMode,
} from '../utils/search-config-core';

export interface HistoryEntry {
  id: string;
  url: string;
  displayUrl: string;
  host: string;
  title?: string;
  inspectedAt: string;
  status: 'completed' | 'failed';
  searchMode?: SearchLinkMode;
  targetKind?: SearchTargetMode;
  enabledTargets?: SearchTargetMode[];
  assetCategory?: ConfigAssetKind;
  assetFormats?: AssetFormatToken[];
  assetKeyword?: string;
  routePath?: string;
  bulkUrls?: string[];
  totalResourceCount?: number;
  detectedCategoryLabel?: string;
}

export interface HistoryStorageSchemaV1 {
  version: 1;
  entries: HistoryEntry[];
}
