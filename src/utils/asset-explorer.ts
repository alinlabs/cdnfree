import type { ResourceRecord } from '../types/inspection.ts';
import { formatBytes } from './format-bytes.ts';
import {
  probeMedia,
  shouldAttemptVideo,
  type MediaProbeResult,
} from './media-probe.ts';
import {
  INLINE_STATIC_LIMIT_BYTES,
  INLINE_STREAM_LIMIT_BYTES,
  evaluateAudioPreview,
  evaluateImagePreview,
  evaluatePdfPreview,
  evaluateVideoPreview,
  isAssetOverInlineLimit,
  isPlayableVideoCandidate,
  isUnverifiedAsset,
  type AudioPreviewDecision,
  type ImagePreviewDecision,
  type PdfPreviewDecision,
  type VideoPreviewDecision,
} from './asset-preview-policy.ts';

export {
  INLINE_STATIC_LIMIT_BYTES,
  INLINE_STREAM_LIMIT_BYTES,
  evaluateAudioPreview,
  evaluateImagePreview,
  evaluatePdfPreview,
  evaluateVideoPreview,
  isAssetOverInlineLimit,
  isPlayableVideoCandidate,
  isUnverifiedAsset,
  probeMedia,
  shouldAttemptVideo,
  type AudioPreviewDecision,
  type ImagePreviewDecision,
  type MediaProbeResult,
  type PdfPreviewDecision,
  type VideoPreviewDecision,
};

export type AssetExplorerGroup = 'image' | 'video' | 'other';

export type InlineAssetPreviewKind =
  | 'image'
  | 'video'
  | 'pdf'
  | 'audio'
  | 'font'
  | 'text'
  | 'none';

function normalizeCanonicalResourceUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

function scoreResourceRichness(resource: ResourceRecord): number {
  let score = 0;
  if (resource.mimeType) score += 2;
  if (typeof resource.declaredBytes === 'number') score += 2;
  if (resource.observation !== 'unknown') score += 2;
  if (resource.posterUrl) score += 1;
  if (resource.source === 'html-img' || resource.source === 'html-video') score += 1;
  if (resource.reason) score += 1;
  return score;
}

export function deduplicateResources(
  resources: ResourceRecord[],
): ResourceRecord[] {
  const byCanonicalUrl = new Map<string, ResourceRecord>();

  for (const item of resources) {
    const key = normalizeCanonicalResourceUrl(item.url);
    const existing = byCanonicalUrl.get(key);
    if (!existing) {
      byCanonicalUrl.set(key, item);
      continue;
    }

    const winner = scoreResourceRichness(item) > scoreResourceRichness(existing)
      ? item
      : existing;
    const loser = winner === item ? existing : item;
    if (!winner.posterUrl && loser.posterUrl) {
      byCanonicalUrl.set(key, { ...winner, posterUrl: loser.posterUrl });
    } else {
      byCanonicalUrl.set(key, winner);
    }
  }

  return Array.from(byCanonicalUrl.values());
}

function parseUrlForPathMetadata(rawUrl: string): URL {
  if (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
    return new URL(rawUrl, 'https://cdnfree.local');
  }
  return new URL(rawUrl);
}

function getPathnameExtension(rawUrl: string): string {
  try {
    const pathname = parseUrlForPathMetadata(rawUrl).pathname.toLowerCase();
    const dotIndex = pathname.lastIndexOf('.');
    const slashIndex = pathname.lastIndexOf('/');
    if (dotIndex === -1 || dotIndex < slashIndex) return '';
    return pathname.slice(dotIndex + 1);
  } catch {
    return '';
  }
}

export function getAssetFilename(rawUrl: string): string {
  try {
    const parsed = parseUrlForPathMetadata(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || parsed.hostname;
  } catch {
    return rawUrl;
  }
}

export function getObservationSourceLabel(
  resource: ResourceRecord,
  wasDownloaded = false,
): string {
  if (wasDownloaded) {
    return `Diunduh oleh pengguna (${resource.source})`;
  }

  if (resource.source === 'browser-observed') {
    return 'Diamati runtime di tampilan proxy (browser-observed)';
  }

  const observationLabel =
    resource.observation === 'discovered'
      ? 'Ditemukan di HTML'
      : resource.observation === 'fetched'
        ? 'Diambil oleh server'
        : resource.observation === 'blocked'
          ? 'Diblokir'
          : 'Tidak diketahui';

  return `${observationLabel} (${resource.source})`;
}

export function classifyAssetGroup(
  resource: ResourceRecord,
): AssetExplorerGroup {
  if (
    resource.assetKind === 'wrapper' ||
    resource.probe?.reason === 'html-wrapper'
  ) {
    return 'other';
  }

  if (resource.assetKind === 'hls' || resource.assetKind === 'dash') {
    return 'video';
  }

  const rawMime = (resource.mimeType ?? '').trim().toLowerCase();
  const mime = rawMime.split(';')[0]?.trim() ?? '';

  if (resource.kind === 'image') {
    const genericSvg =
      isSvgResource(resource) &&
      (mime === 'text/plain' || mime === 'application/octet-stream');
    // Preserve uncertainty if trustworthy non-generic MIME conflicts with image kind
    if (mime && !mime.startsWith('image/') && !genericSvg) {
      return 'other';
    }
    return 'image';
  }

  if (resource.kind === 'video') {
    const isGenericBinary =
      !mime ||
      mime === 'application/octet-stream' ||
      mime === 'binary/octet-stream' ||
      (mime === 'text/plain' && shouldAttemptVideo(mime, resource.url));
    const videoCompatibleMime =
      isGenericBinary ||
      mime.startsWith('video/') ||
      mime === 'application/vnd.apple.mpegurl' ||
      mime === 'application/x-mpegurl' ||
      mime === 'application/dash+xml';
    return videoCompatibleMime ? 'video' : 'other';
  }

  if (resource.kind === 'other') {
    if (mime.startsWith('image/') || isSvgResource(resource)) return 'image';
    if (mime.startsWith('video/') || shouldAttemptVideo(mime, resource.url)) {
      return 'video';
    }
  }

  return 'other';
}

export function getAssetSectionVisibility(
  kindFilter: 'all' | ResourceRecord['kind'],
  counts: { image: number; video: number; other: number },
  hasFormatFilter = false,
): { showImageSection: boolean; showVideoSection: boolean; showOtherSection: boolean } {
  if (hasFormatFilter) {
    return {
      showImageSection: counts.image > 0,
      showVideoSection: counts.video > 0,
      showOtherSection: counts.other > 0,
    };
  }
  return {
    showImageSection:
      kindFilter === 'all' || kindFilter === 'image' || counts.image > 0,
    showVideoSection:
      kindFilter === 'all' || kindFilter === 'video' || counts.video > 0,
    showOtherSection:
      kindFilter === 'all' ||
      (kindFilter !== 'image' && kindFilter !== 'video') ||
      counts.other > 0,
  };
}

export function isSvgResource(resource: ResourceRecord): boolean {
  if (resource.assetKind === 'vector') return true;
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  return mime === 'image/svg+xml' || ext === 'svg' || ext === 'svgz';
}

export function getImageFormatLabel(resource: ResourceRecord): string {
  if (isSvgResource(resource)) return 'SVG';
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  const byMime: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/jpg': 'JPG',
    'image/webp': 'WEBP',
    'image/avif': 'AVIF',
    'image/gif': 'GIF',
    'image/x-icon': 'ICO',
    'image/vnd.microsoft.icon': 'ICO',
    'image/bmp': 'BMP',
  };
  if (byMime[mime]) return byMime[mime];
  if (ext) return ext.toUpperCase();
  return 'IMG';
}

export function getVideoFormatLabel(resource: ResourceRecord): string {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  const byMime: Record<string, string> = {
    'video/mp4': 'MP4',
    'video/webm': 'WEBM',
    'video/ogg': 'OGG',
    'video/quicktime': 'MOV',
    'video/x-msvideo': 'AVI',
    'video/x-matroska': 'MKV',
    'application/vnd.apple.mpegurl': 'HLS',
    'application/x-mpegurl': 'HLS',
    'application/dash+xml': 'DASH',
  };
  if (byMime[mime]) return byMime[mime];
  if (ext) return ext.toUpperCase();
  return 'VIDEO';
}

export function formatCompactAssetBadge(
  formatLabel: string,
  declaredBytes?: number | null,
): string {
  if (
    typeof declaredBytes === 'number' &&
    Number.isFinite(declaredBytes) &&
    declaredBytes >= 0
  ) {
    return `${formatLabel} · ${formatBytes(declaredBytes)}`;
  }
  return formatLabel;
}

export function isPdfResource(resource: ResourceRecord): boolean {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  return mime === 'application/pdf' || ext === 'pdf';
}

export function isAudioResource(resource: ResourceRecord): boolean {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  return (
    resource.kind === 'audio' ||
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'opus', 'aac'].includes(ext)
  );
}

export function isFontResource(resource: ResourceRecord): boolean {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  return (
    resource.kind === 'font' ||
    mime.startsWith('font/') ||
    mime === 'application/font-woff' ||
    mime === 'application/font-woff2' ||
    ['woff2', 'woff', 'ttf', 'otf'].includes(ext)
  );
}

export function isTextPreviewableResource(resource: ResourceRecord): boolean {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  if (isPdfResource(resource) || isSvgResource(resource)) return false;
  return (
    resource.kind === 'stylesheet' ||
    resource.kind === 'script' ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime.includes('javascript') ||
    ['css', 'js', 'mjs', 'cjs', 'json', 'xml', 'txt', 'csv', 'html', 'htm'].includes(ext)
  );
}

export function getInlineAssetPreviewKind(
  resource: ResourceRecord,
): InlineAssetPreviewKind {
  if (classifyAssetGroup(resource) === 'image') return 'image';
  if (classifyAssetGroup(resource) === 'video') return 'video';
  if (isPdfResource(resource)) return 'pdf';
  if (isAudioResource(resource)) return 'audio';
  if (isFontResource(resource)) return 'font';
  if (isTextPreviewableResource(resource)) return 'text';
  return 'none';
}
