import {
  ASSET_FORMAT_PRESETS,
  DEFAULT_SEARCH_CONFIG,
  normalizeTargetModes,
  VALID_ASSET_KINDS,
  type AssetFormatToken,
  type ConfigAssetKind,
  type LinkModeOrigin,
  type SearchConfigState,
  type SearchLinkMode,
  type SearchTargetMode,
} from './search-config-core';

export const SEARCH_CONFIG_STORAGE_KEY = 'cdnfree:search-config:v1';

const FORMAT_PRESET_SET = new Set<string>(
  ASSET_FORMAT_PRESETS.map((preset) => preset.value),
);

export interface SearchConfigStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedSearchConfigState {
  config: SearchConfigState;
  linkModeOrigin: LinkModeOrigin;
  savedSingleTargetMode: SearchTargetMode;
  savedSingleTargetModes?: SearchTargetMode[];
}

export const DEFAULT_PERSISTED_SEARCH_CONFIG: PersistedSearchConfigState = {
  config: DEFAULT_SEARCH_CONFIG,
  linkModeOrigin: 'default',
  savedSingleTargetMode: DEFAULT_SEARCH_CONFIG.targetMode,
  savedSingleTargetModes: [DEFAULT_SEARCH_CONFIG.targetMode],
};

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

function sanitizeTargetModes(
  rawModes: unknown,
  fallbackTarget: SearchTargetMode,
): SearchTargetMode[] {
  if (!Array.isArray(rawModes)) {
    return [fallbackTarget];
  }
  const valid = rawModes.filter(
    (item): item is SearchTargetMode =>
      item === 'web' || item === 'detail' || item === 'aset',
  );
  return normalizeTargetModes(valid, fallbackTarget);
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
  const baseTargetMode = sanitizeTargetMode(obj.targetMode);
  const targetModes: SearchTargetMode[] =
    linkMode === 'bulk'
      ? ['aset']
      : sanitizeTargetModes(obj.targetModes, baseTargetMode);
  const targetMode: SearchTargetMode =
    linkMode === 'bulk' ? 'aset' : targetModes[0];

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
        .filter((item): item is AssetFormatToken => FORMAT_PRESET_SET.has(item)),
    ),
  );

  const assetKeyword =
    typeof obj.assetKeyword === 'string' ? obj.assetKeyword.slice(0, 200) : '';

  return {
    linkMode,
    targetMode,
    targetModes,
    assetKind,
    assetFormats: cleanFormats,
    assetKeyword,
  };
}

function sanitizePersistedSearchConfig(
  raw: unknown,
): PersistedSearchConfigState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const config = sanitizeSearchConfigState(obj.config ?? obj);
  if (!config) return null;

  const savedSingleTargetMode = sanitizeTargetMode(obj.savedSingleTargetMode);
  const savedSingleTargetModes = sanitizeTargetModes(
    obj.savedSingleTargetModes,
    savedSingleTargetMode,
  );

  return {
    config,
    linkModeOrigin: sanitizeLinkModeOrigin(obj.linkModeOrigin),
    savedSingleTargetMode: savedSingleTargetModes[0],
    savedSingleTargetModes,
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
