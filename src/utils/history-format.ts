import { buildResultsRoutePath } from '../pages/hasil-pencarian/shared/results-navigation';
import type { HistoryEntry } from '../types/history';
import type { ConfigAssetKind } from './search-config-core';

const ASSET_KIND_LABELS: Record<ConfigAssetKind, string> = {
  all: 'Semua',
  image: 'Gambar',
  video: 'Video',
  audio: 'Audio',
  document: 'Dokumen',
  font: 'Font',
  stylesheet: 'CSS',
  script: 'Script',
  other: 'Lainnya',
};

const TARGET_LABELS: Record<'web' | 'detail' | 'aset', string> = {
  web: 'Web',
  detail: 'Detail',
  aset: 'Aset',
};

export function getHistoryCategoryLabel(entry: HistoryEntry): string | null {
  if (entry.assetCategory && entry.assetCategory !== 'all') {
    return ASSET_KIND_LABELS[entry.assetCategory] ?? null;
  }
  if (entry.assetFormats && entry.assetFormats.length > 0) {
    return entry.assetFormats
      .slice(0, 3)
      .map((fmt) => fmt.toUpperCase())
      .join(', ');
  }
  if (entry.detectedCategoryLabel?.trim()) {
    return entry.detectedCategoryLabel.trim();
  }
  if (entry.targetKind === 'aset' || entry.searchMode === 'bulk') {
    return 'Semua';
  }
  return null;
}

export function formatHistoryHeadline(entry: HistoryEntry): string {
  const modeLabel = entry.searchMode === 'bulk' ? 'Bulk Link' : 'Single Link';
  const resolvedTarget: 'web' | 'detail' | 'aset' =
    entry.searchMode === 'bulk' ? 'aset' : (entry.targetKind ?? 'web');
  const targetLabel = TARGET_LABELS[resolvedTarget] ?? 'Web';
  const categoryLabel = getHistoryCategoryLabel(entry);

  if (resolvedTarget === 'aset' && categoryLabel) {
    return `${modeLabel} ${targetLabel} ${categoryLabel}`;
  }
  if (categoryLabel && categoryLabel !== 'Semua') {
    return `${modeLabel} ${targetLabel} ${categoryLabel}`;
  }
  return `${modeLabel} ${targetLabel}`;
}

export function formatHistoryAssetSummary(entry: HistoryEntry): string {
  if (entry.status === 'failed') {
    return 'Pemeriksaan gagal';
  }
  const count =
    typeof entry.totalResourceCount === 'number' &&
    Number.isFinite(entry.totalResourceCount) &&
    entry.totalResourceCount >= 0
      ? Math.round(entry.totalResourceCount)
      : 0;

  if (count === 0) {
    return '0 aset terdeteksi';
  }

  const categoryLabel = getHistoryCategoryLabel(entry);
  if (categoryLabel && categoryLabel !== 'Semua') {
    return `${count} Aset ${categoryLabel}`;
  }
  return `${count} aset terdeteksi`;
}

export function resolveHistoryRoutePath(entry: HistoryEntry): string {
  if (entry.routePath && entry.routePath.startsWith('/')) {
    return entry.routePath;
  }

  const target =
    entry.searchMode === 'bulk' ? 'aset' : (entry.targetKind ?? 'web');
  return buildResultsRoutePath(target, {
    url: entry.searchMode === 'bulk' ? undefined : entry.url,
    bulkId: entry.searchMode === 'bulk' ? entry.id : undefined,
    jenis: entry.assetCategory,
    fmt: entry.assetFormats,
    q: entry.assetKeyword,
  });
}

export function buildHistoryDisplayUrl(
  entry: HistoryEntry,
  origin?: string,
): string {
  const resolvedOrigin =
    origin ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://cdnfree.vercel.app');
  return `${resolvedOrigin.replace(/\/+$/, '')}${resolveHistoryRoutePath(entry)}`;
}
