import type { ResourceRecord } from '../types/inspection';
import {
  ASSET_FORMAT_PRESETS,
  DEFAULT_SEARCH_CONFIG,
  FORMAT_PRESET_MAP,
  getEnabledTargetModes,
  normalizeTargetModes,
  SEARCH_TARGET_ORDER,
  VALID_ASSET_KINDS,
  type AssetFormatPreset,
  type AssetFormatToken,
  type ConfigAssetKind,
  type LinkModeOrigin,
  type SearchConfigState,
  type SearchLinkMode,
  type SearchTargetMode,
} from './search-config-core';
import {
  DEFAULT_PERSISTED_SEARCH_CONFIG,
  loadSearchConfig,
  resetSearchConfig,
  saveSearchConfig,
  SEARCH_CONFIG_STORAGE_KEY,
  type PersistedSearchConfigState,
  type SearchConfigStorageLike,
} from './search-config-storage';
import { extractUrlsFromInput } from './smart-url-parser';

export {
  ASSET_FORMAT_PRESETS,
  DEFAULT_PERSISTED_SEARCH_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  getEnabledTargetModes,
  loadSearchConfig,
  normalizeTargetModes,
  resetSearchConfig,
  saveSearchConfig,
  SEARCH_CONFIG_STORAGE_KEY,
  SEARCH_TARGET_ORDER,
  VALID_ASSET_KINDS,
  type AssetFormatPreset,
  type AssetFormatToken,
  type ConfigAssetKind,
  type LinkModeOrigin,
  type PersistedSearchConfigState,
  type SearchConfigState,
  type SearchConfigStorageLike,
  type SearchLinkMode,
  type SearchTargetMode,
};

export function applyLinkModeChange(
  state: SearchConfigState,
  nextLinkMode: SearchLinkMode,
  savedSingleTargetModes?: readonly SearchTargetMode[],
): SearchConfigState {
  if (nextLinkMode === state.linkMode) return state;
  if (nextLinkMode === 'bulk') {
    return {
      ...state,
      linkMode: 'bulk',
      targetMode: 'aset',
      targetModes: ['aset'],
    };
  }
  const restoredModes =
    savedSingleTargetModes && savedSingleTargetModes.length > 0
      ? normalizeTargetModes(savedSingleTargetModes, savedSingleTargetModes[0])
      : normalizeTargetModes(state.targetModes, state.targetMode);
  return {
    ...state,
    linkMode: 'single',
    targetMode: restoredModes[0],
    targetModes: restoredModes,
  };
}

export function applyTargetModeChange(
  state: SearchConfigState,
  nextTargetMode: SearchTargetMode,
): SearchConfigState {
  if (state.linkMode === 'bulk' && nextTargetMode !== 'aset') {
    return {
      ...state,
      targetMode: 'aset',
      targetModes: ['aset'],
    };
  }
  return {
    ...state,
    targetMode: nextTargetMode,
    targetModes: [nextTargetMode],
  };
}

export function toggleTargetMode(
  state: SearchConfigState,
  target: SearchTargetMode,
): SearchConfigState {
  if (state.linkMode === 'bulk') {
    return {
      ...state,
      targetMode: 'aset',
      targetModes: ['aset'],
    };
  }

  const current = getEnabledTargetModes(state);
  const exists = current.includes(target);
  if (exists) {
    // Minimal 1 tujuan hasil harus tetap aktif
    if (current.length <= 1) {
      return state;
    }
    const next = current.filter((item) => item !== target);
    return {
      ...state,
      targetMode: next[0],
      targetModes: next,
    };
  }

  const next = normalizeTargetModes([...current, target], target);
  return {
    ...state,
    targetMode: next[0],
    targetModes: next,
  };
}

export function applyAssetKindChange(
  state: SearchConfigState,
  nextKind: ConfigAssetKind,
): SearchConfigState {
  if (nextKind === 'all') {
    return { ...state, assetKind: 'all' };
  }
  const compatibleFormats = state.assetFormats.filter((token) => {
    const preset = FORMAT_PRESET_MAP.get(token);
    return preset?.kind === nextKind;
  });
  return {
    ...state,
    assetKind: nextKind,
    assetFormats: compatibleFormats,
  };
}

export function toggleAssetFormat(
  state: SearchConfigState,
  token: AssetFormatToken,
): SearchConfigState {
  const exists = state.assetFormats.includes(token);
  if (exists) {
    return {
      ...state,
      assetFormats: state.assetFormats.filter((item) => item !== token),
    };
  }
  const preset = FORMAT_PRESET_MAP.get(token);
  const nextFormats = [...state.assetFormats, token];
  const needsKindReset =
    state.assetKind !== 'all' && preset && preset.kind !== state.assetKind;

  return {
    ...state,
    assetKind: needsKindReset ? 'all' : state.assetKind,
    assetFormats: nextFormats,
  };
}

export function hasCustomSearchConfig(state: SearchConfigState): boolean {
  const enabled = getEnabledTargetModes(state);
  return (
    state.linkMode !== 'single' ||
    state.targetMode !== 'web' ||
    enabled.length !== 1 ||
    enabled[0] !== 'web' ||
    state.assetKind !== 'all' ||
    state.assetFormats.length > 0 ||
    state.assetKeyword.trim().length > 0
  );
}

export function parseAssetFormatFilters(raw: string | null): AssetFormatToken[] {
  if (!raw) return [];
  const tokens = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is AssetFormatToken => FORMAT_PRESET_MAP.has(part));
  return Array.from(new Set(tokens));
}

export function serializeAssetFormatFilters(
  formats: readonly AssetFormatToken[],
): string {
  const unique = Array.from(
    new Set(formats.filter((item) => FORMAT_PRESET_MAP.has(item))),
  );
  return unique.join(',');
}

function getNormalizedPathnameExtension(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const dot = pathname.lastIndexOf('.');
    const slash = pathname.lastIndexOf('/');
    if (dot === -1 || dot < slash) return '';
    return pathname.slice(dot + 1);
  } catch {
    return '';
  }
}

export function matchesAssetFormatFilter(
  resource: ResourceRecord,
  formats: readonly AssetFormatToken[],
): boolean {
  if (formats.length === 0) return true;
  const ext = getNormalizedPathnameExtension(resource.url);
  const baseMime =
    (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const lowerUrl = resource.url.toLowerCase();

  return formats.some((token) => {
    const preset = FORMAT_PRESET_MAP.get(token);
    if (!preset) return false;
    if (ext && preset.extensions.includes(ext)) return true;
    if (baseMime && preset.mimeTypes.includes(baseMime)) return true;
    return preset.extensions.some(
      (candidateExt) =>
        lowerUrl.includes(`.${candidateExt}?`) ||
        lowerUrl.includes(`.${candidateExt}&`) ||
        lowerUrl.includes(`format=${candidateExt}`),
    );
  });
}

export interface BulkInvalidEntry {
  raw: string;
  message: string;
}

export interface ParseBulkUrlsResult {
  validUrls: string[];
  invalidEntries: BulkInvalidEntry[];
  truncatedCount: number;
}

export const MAX_BULK_URLS = 20;

export function parseBulkUrlsInput(
  rawInput: string,
  maxUrls = MAX_BULK_URLS,
): ParseBulkUrlsResult {
  const extracted = extractUrlsFromInput(rawInput);

  const validUrls = extracted.validUrls.slice(0, maxUrls);
  const truncatedCount = Math.max(0, extracted.validUrls.length - maxUrls);
  const invalidEntries: BulkInvalidEntry[] = extracted.rejectedCandidates.map(
    (entry) => ({
      raw: entry.raw,
      message: entry.message,
    }),
  );

  return {
    validUrls,
    invalidEntries,
    truncatedCount,
  };
}

export const AUTO_BULK_URL_THRESHOLD = 2;

export interface AutoBulkResolution {
  config: SearchConfigState;
  origin: LinkModeOrigin;
  savedSingleTargetMode: SearchTargetMode;
  savedSingleTargetModes?: SearchTargetMode[];
  suppressAutoBulk: boolean;
  detectedUrlCount: number;
}

export function resolveAutoBulkForUrlInput(params: {
  rawUrlInput: string;
  currentConfig: SearchConfigState;
  origin: LinkModeOrigin;
  savedSingleTargetMode: SearchTargetMode;
  savedSingleTargetModes?: SearchTargetMode[];
  suppressAutoBulk: boolean;
}): AutoBulkResolution {
  const {
    rawUrlInput,
    currentConfig,
    origin,
    savedSingleTargetMode,
    savedSingleTargetModes,
    suppressAutoBulk,
  } = params;

  const detectedUrlCount = extractUrlsFromInput(rawUrlInput).validUrls.length;
  const restoredModes = normalizeTargetModes(
    savedSingleTargetModes,
    savedSingleTargetMode,
  );

  if (detectedUrlCount >= AUTO_BULK_URL_THRESHOLD) {
    if (currentConfig.linkMode === 'single' && !suppressAutoBulk) {
      const currentModes = getEnabledTargetModes(currentConfig);
      return {
        config: applyLinkModeChange(currentConfig, 'bulk'),
        origin: 'auto',
        savedSingleTargetMode: currentModes[0],
        savedSingleTargetModes: currentModes,
        suppressAutoBulk: false,
        detectedUrlCount,
      };
    }

    return {
      config: currentConfig,
      origin,
      savedSingleTargetMode,
      savedSingleTargetModes: restoredModes,
      suppressAutoBulk,
      detectedUrlCount,
    };
  }

  if (origin === 'auto' && currentConfig.linkMode === 'bulk') {
    return {
      config: {
        ...currentConfig,
        linkMode: 'single',
        targetMode: restoredModes[0],
        targetModes: restoredModes,
      },
      origin: 'default',
      savedSingleTargetMode: restoredModes[0],
      savedSingleTargetModes: restoredModes,
      suppressAutoBulk: false,
      detectedUrlCount,
    };
  }

  return {
    config: currentConfig,
    origin,
    savedSingleTargetMode,
    savedSingleTargetModes: restoredModes,
    suppressAutoBulk: false,
    detectedUrlCount,
  };
}

export function resolveSingleLinkSubmitFromBulk(params: {
  currentConfig: SearchConfigState;
  savedSingleTargetMode: SearchTargetMode;
  savedSingleTargetModes?: SearchTargetMode[];
}): SearchConfigState {
  const { currentConfig, savedSingleTargetMode, savedSingleTargetModes } = params;
  const hasExplicitAssetFilter =
    currentConfig.assetKind !== 'all' ||
    currentConfig.assetFormats.length > 0 ||
    currentConfig.assetKeyword.trim().length > 0;
  const restoredModes = hasExplicitAssetFilter
    ? (['aset'] as SearchTargetMode[])
    : normalizeTargetModes(savedSingleTargetModes, savedSingleTargetMode);
  return {
    ...currentConfig,
    linkMode: 'single',
    targetMode: restoredModes[0],
    targetModes: restoredModes,
  };
}

const KIND_SUMMARY_LABELS: Record<ResourceRecord['kind'], string> = {
  image: 'Gambar',
  video: 'Video',
  audio: 'Audio',
  script: 'Script',
  stylesheet: 'Stylesheet',
  font: 'Font',
  document: 'Dokumen',
  other: 'Lainnya',
};

const TARGET_SUMMARY_LABELS: Record<SearchTargetMode, string> = {
  web: 'Tampilkan Web',
  detail: 'Cari Detail Data Web',
  aset: 'Aset Saja',
};

export function buildSearchConfigSummary(state: SearchConfigState): string {
  const modeLabel = state.linkMode === 'bulk' ? 'Bulk link' : 'Single link';
  const enabledTargets = getEnabledTargetModes(state);
  const targetLabel = enabledTargets
    .map((target) => TARGET_SUMMARY_LABELS[target])
    .join(' + ');

  if (!enabledTargets.includes('aset')) {
    return `${modeLabel} · ${targetLabel}`;
  }

  const filterParts: string[] = [];
  if (state.assetKind !== 'all') {
    filterParts.push(KIND_SUMMARY_LABELS[state.assetKind] ?? state.assetKind);
  }
  if (state.assetFormats.length > 0) {
    filterParts.push(
      state.assetFormats.map((item) => item.toUpperCase()).join(', '),
    );
  }
  if (state.assetKeyword.trim()) {
    filterParts.push(`"${state.assetKeyword.trim()}"`);
  }

  return filterParts.length > 0
    ? `${modeLabel} · ${targetLabel} (${filterParts.join(' · ')})`
    : `${modeLabel} · ${targetLabel}`;
}
