import type { ResourceRecord } from '../types/inspection';
import { extractUrlsFromInput } from './smart-url-parser';

export type SearchLinkMode = 'single' | 'bulk';
export type SearchTargetMode = 'web' | 'detail' | 'aset';
export type ConfigAssetKind = 'all' | ResourceRecord['kind'];

export type AssetFormatToken =
  | 'jpg'
  | 'png'
  | 'webp'
  | 'svg'
  | 'gif'
  | 'avif'
  | 'mp4'
  | 'webm'
  | 'pdf'
  | 'mp3'
  | 'css'
  | 'js'
  | 'woff2';

export interface AssetFormatPreset {
  value: AssetFormatToken;
  label: string;
  kind: ResourceRecord['kind'];
  extensions: readonly string[];
  mimeTypes: readonly string[];
}

export const ASSET_FORMAT_PRESETS: readonly AssetFormatPreset[] = [
  {
    value: 'jpg',
    label: 'JPG',
    kind: 'image',
    extensions: ['jpg', 'jpeg', 'jfif'],
    mimeTypes: ['image/jpeg', 'image/jpg'],
  },
  {
    value: 'png',
    label: 'PNG',
    kind: 'image',
    extensions: ['png'],
    mimeTypes: ['image/png'],
  },
  {
    value: 'webp',
    label: 'WEBP',
    kind: 'image',
    extensions: ['webp'],
    mimeTypes: ['image/webp'],
  },
  {
    value: 'svg',
    label: 'SVG',
    kind: 'image',
    extensions: ['svg'],
    mimeTypes: ['image/svg+xml'],
  },
  {
    value: 'gif',
    label: 'GIF',
    kind: 'image',
    extensions: ['gif'],
    mimeTypes: ['image/gif'],
  },
  {
    value: 'avif',
    label: 'AVIF',
    kind: 'image',
    extensions: ['avif'],
    mimeTypes: ['image/avif'],
  },
  {
    value: 'mp4',
    label: 'MP4',
    kind: 'video',
    extensions: ['mp4', 'm4v'],
    mimeTypes: ['video/mp4'],
  },
  {
    value: 'webm',
    label: 'WEBM',
    kind: 'video',
    extensions: ['webm'],
    mimeTypes: ['video/webm'],
  },
  {
    value: 'pdf',
    label: 'PDF',
    kind: 'document',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
  },
  {
    value: 'mp3',
    label: 'MP3',
    kind: 'audio',
    extensions: ['mp3'],
    mimeTypes: ['audio/mpeg', 'audio/mp3'],
  },
  {
    value: 'css',
    label: 'CSS',
    kind: 'stylesheet',
    extensions: ['css'],
    mimeTypes: ['text/css'],
  },
  {
    value: 'js',
    label: 'JS',
    kind: 'script',
    extensions: ['js', 'mjs', 'cjs'],
    mimeTypes: [
      'application/javascript',
      'text/javascript',
      'application/ecmascript',
      'text/ecmascript',
    ],
  },
  {
    value: 'woff2',
    label: 'WOFF2',
    kind: 'font',
    extensions: ['woff2', 'woff'],
    mimeTypes: ['font/woff2', 'font/woff', 'application/font-woff2'],
  },
];

const FORMAT_PRESET_MAP = new Map<string, AssetFormatPreset>(
  ASSET_FORMAT_PRESETS.map((preset) => [preset.value, preset]),
);

export interface SearchConfigState {
  linkMode: SearchLinkMode;
  targetMode: SearchTargetMode;
  assetKind: ConfigAssetKind;
  assetFormats: AssetFormatToken[];
  assetKeyword: string;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfigState = {
  linkMode: 'single',
  targetMode: 'web',
  assetKind: 'all',
  assetFormats: [],
  assetKeyword: '',
};

export function applyLinkModeChange(
  state: SearchConfigState,
  nextLinkMode: SearchLinkMode,
): SearchConfigState {
  if (nextLinkMode === state.linkMode) return state;
  if (nextLinkMode === 'bulk') {
    return {
      ...state,
      linkMode: 'bulk',
      targetMode: 'aset',
    };
  }
  return {
    ...state,
    linkMode: 'single',
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
    };
  }
  return {
    ...state,
    targetMode: nextTargetMode,
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
  return (
    state.linkMode !== 'single' ||
    state.targetMode !== 'web' ||
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
    new Set(
      formats.filter((item) => FORMAT_PRESET_MAP.has(item)),
    ),
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

export type LinkModeOrigin = 'default' | 'manual' | 'auto';

export interface AutoBulkResolution {
  config: SearchConfigState;
  origin: LinkModeOrigin;
  savedSingleTargetMode: SearchTargetMode;
  suppressAutoBulk: boolean;
  detectedUrlCount: number;
}

export function resolveAutoBulkForUrlInput(params: {
  rawUrlInput: string;
  currentConfig: SearchConfigState;
  origin: LinkModeOrigin;
  savedSingleTargetMode: SearchTargetMode;
  suppressAutoBulk: boolean;
}): AutoBulkResolution {
  const {
    rawUrlInput,
    currentConfig,
    origin,
    savedSingleTargetMode,
    suppressAutoBulk,
  } = params;

  const detectedUrlCount = extractUrlsFromInput(rawUrlInput).validUrls.length;

  if (detectedUrlCount >= AUTO_BULK_URL_THRESHOLD) {
    if (currentConfig.linkMode === 'single' && !suppressAutoBulk) {
      return {
        config: applyLinkModeChange(currentConfig, 'bulk'),
        origin: 'auto',
        savedSingleTargetMode: currentConfig.targetMode,
        suppressAutoBulk: false,
        detectedUrlCount,
      };
    }

    return {
      config: currentConfig,
      origin,
      savedSingleTargetMode,
      suppressAutoBulk,
      detectedUrlCount,
    };
  }

  if (origin === 'auto' && currentConfig.linkMode === 'bulk') {
    return {
      config: {
        ...currentConfig,
        linkMode: 'single',
        targetMode: savedSingleTargetMode,
      },
      origin: 'default',
      savedSingleTargetMode,
      suppressAutoBulk: false,
      detectedUrlCount,
    };
  }

  return {
    config: currentConfig,
    origin,
    savedSingleTargetMode,
    suppressAutoBulk: false,
    detectedUrlCount,
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

export function buildSearchConfigSummary(state: SearchConfigState): string {
  const modeLabel = state.linkMode === 'bulk' ? 'Bulk link' : 'Single link';
  const targetLabel =
    state.targetMode === 'web'
      ? 'Tampilkan Web'
      : state.targetMode === 'detail'
        ? 'Cari Detail Data Web'
        : 'Aset Saja';

  if (state.targetMode !== 'aset') {
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

export const SEARCH_CONFIG_STORAGE_KEY = 'cdnfree:search-config:v1';

export interface SearchConfigStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedSearchConfigState {
  config: SearchConfigState;
  linkModeOrigin: LinkModeOrigin;
  savedSingleTargetMode: SearchTargetMode;
}

export const DEFAULT_PERSISTED_SEARCH_CONFIG: PersistedSearchConfigState = {
  config: DEFAULT_SEARCH_CONFIG,
  linkModeOrigin: 'default',
  savedSingleTargetMode: DEFAULT_SEARCH_CONFIG.targetMode,
};

const VALID_ASSET_KINDS = new Set<ConfigAssetKind>([
  'all',
  'image',
  'video',
  'audio',
  'script',
  'stylesheet',
  'font',
  'document',
  'other',
]);

function getDefaultSearchConfigStorage(): SearchConfigStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitizeTargetMode(value: unknown): SearchTargetMode {
  return value === 'web' || value === 'detail' || value === 'aset'
    ? value
    : DEFAULT_SEARCH_CONFIG.targetMode;
}

function sanitizeLinkModeOrigin(value: unknown): LinkModeOrigin {
  return value === 'default' || value === 'manual' || value === 'auto'
    ? value
    : 'default';
}

function sanitizeSearchConfigState(raw: unknown): SearchConfigState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const linkMode: SearchLinkMode = obj.linkMode === 'bulk' ? 'bulk' : 'single';
  const targetMode: SearchTargetMode =
    linkMode === 'bulk' ? 'aset' : sanitizeTargetMode(obj.targetMode);
  const assetKind: ConfigAssetKind =
    typeof obj.assetKind === 'string' &&
    VALID_ASSET_KINDS.has(obj.assetKind as ConfigAssetKind)
      ? (obj.assetKind as ConfigAssetKind)
      : DEFAULT_SEARCH_CONFIG.assetKind;

  const rawFormats = Array.isArray(obj.assetFormats) ? obj.assetFormats : [];
  const cleanFormats = Array.from(
    new Set(
      rawFormats
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is AssetFormatToken => FORMAT_PRESET_MAP.has(item)),
    ),
  );

  const assetKeyword =
    typeof obj.assetKeyword === 'string' ? obj.assetKeyword.slice(0, 200) : '';

  return {
    linkMode,
    targetMode,
    assetKind,
    assetFormats: cleanFormats,
    assetKeyword,
  };
}

function sanitizePersistedSearchConfig(raw: unknown): PersistedSearchConfigState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const config = sanitizeSearchConfigState(obj.config ?? obj);
  if (!config) return null;

  return {
    config,
    linkModeOrigin: sanitizeLinkModeOrigin(obj.linkModeOrigin),
    savedSingleTargetMode: sanitizeTargetMode(obj.savedSingleTargetMode),
  };
}

export function loadSearchConfig(
  storage: SearchConfigStorageLike | null = getDefaultSearchConfigStorage(),
): PersistedSearchConfigState {
  if (!storage) return DEFAULT_PERSISTED_SEARCH_CONFIG;
  try {
    const raw = storage.getItem(SEARCH_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_PERSISTED_SEARCH_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    return sanitizePersistedSearchConfig(parsed) ?? DEFAULT_PERSISTED_SEARCH_CONFIG;
  } catch {
    return DEFAULT_PERSISTED_SEARCH_CONFIG;
  }
}

export function saveSearchConfig(
  next: PersistedSearchConfigState,
  storage: SearchConfigStorageLike | null = getDefaultSearchConfigStorage(),
): PersistedSearchConfigState {
  const sanitized =
    sanitizePersistedSearchConfig(next) ?? DEFAULT_PERSISTED_SEARCH_CONFIG;
  if (!storage) return sanitized;
  try {
    storage.setItem(
      SEARCH_CONFIG_STORAGE_KEY,
      JSON.stringify({ version: 1, ...sanitized }),
    );
  } catch {
    // Ignore storage quota or private browsing write failures
  }
  return sanitized;
}

export function resetSearchConfig(
  storage: SearchConfigStorageLike | null = getDefaultSearchConfigStorage(),
): PersistedSearchConfigState {
  if (!storage) return DEFAULT_PERSISTED_SEARCH_CONFIG;
  try {
    storage.removeItem(SEARCH_CONFIG_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors
  }
  return DEFAULT_PERSISTED_SEARCH_CONFIG;
}

