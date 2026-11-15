import type { ResourceRecord } from '../types/inspection';

export type SearchLinkMode = 'single' | 'bulk';
export type SearchTargetMode = 'web' | 'detail' | 'aset';
export type ConfigAssetKind = 'all' | ResourceRecord['kind'];
export type LinkModeOrigin = 'default' | 'manual' | 'auto';

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

export const FORMAT_PRESET_MAP = new Map<string, AssetFormatPreset>(
  ASSET_FORMAT_PRESETS.map((preset) => [preset.value, preset]),
);

export const SEARCH_TARGET_ORDER: readonly SearchTargetMode[] = [
  'web',
  'detail',
  'aset',
];

export interface SearchConfigState {
  linkMode: SearchLinkMode;
  targetMode: SearchTargetMode;
  targetModes?: SearchTargetMode[];
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

export const VALID_ASSET_KINDS = new Set<ConfigAssetKind>([
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

export function normalizeTargetModes(
  modes: readonly SearchTargetMode[] | undefined,
  fallbackTarget: SearchTargetMode = 'web',
): SearchTargetMode[] {
  const unique = new Set(modes ?? []);
  const ordered = SEARCH_TARGET_ORDER.filter((mode) => unique.has(mode));
  return ordered.length > 0 ? ordered : [fallbackTarget];
}

export function getEnabledTargetModes(
  state: Pick<SearchConfigState, 'linkMode' | 'targetMode' | 'targetModes'>,
): SearchTargetMode[] {
  if (state.linkMode === 'bulk') {
    return ['aset'];
  }
  if (!state.targetModes || state.targetModes.length === 0) {
    return [state.targetMode];
  }
  return normalizeTargetModes(state.targetModes, state.targetMode);
}
