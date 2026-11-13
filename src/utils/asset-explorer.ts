import type { ResourceRecord } from '../types/inspection.ts';
import { formatBytes } from './format-bytes.ts';
import {
  probeMedia,
  shouldAttemptVideo,
  STREAM_MANIFEST_MIMES,
  type MediaProbeResult,
} from './media-probe.ts';
import { isProhibitedHostname } from './normalize-url.ts';
import { validateExternalNavigationUrl } from './safe-external-url.ts';

export { probeMedia, shouldAttemptVideo, type MediaProbeResult };

export type AssetExplorerGroup = 'image' | 'video' | 'other';

export interface ImagePreviewDecision {
  canRenderImg: boolean;
  status:
    | 'render-img'
    | 'unsupported-format'
    | 'restricted'
    | 'mixed-content'
    | 'unsafe-url';
  note?: string;
}

export interface VideoPreviewDecision {
  canRenderVideo: boolean;
  status:
    | 'native-video'
    | 'unsupported-stream'
    | 'unknown-mime'
    | 'restricted'
    | 'mixed-content'
    | 'unsafe-url';
  note?: string;
}

export interface PdfPreviewDecision {
  canRenderPdf: boolean;
  status: 'render-pdf' | 'restricted' | 'mixed-content' | 'unsafe-url';
  note?: string;
}

export interface AudioPreviewDecision {
  canRenderAudio: boolean;
  status: 'native-audio' | 'restricted' | 'mixed-content' | 'unsafe-url';
  note?: string;
}

export type InlineAssetPreviewKind =
  | 'image'
  | 'video'
  | 'pdf'
  | 'audio'
  | 'font'
  | 'text'
  | 'none';

const UNSUPPORTED_RASTER_EXTS = new Set(['tif', 'tiff', 'psd', 'raw']);

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

function getPathnameExtension(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
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
    const parsed = new URL(rawUrl);
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
  const rawMime = (resource.mimeType ?? '').trim().toLowerCase();
  const mime = rawMime.split(';')[0]?.trim() ?? '';

  if (resource.kind === 'image') {
    // Preserve uncertainty if trustworthy MIME metadata conflicts with image kind
    if (mime && !mime.startsWith('image/')) {
      return 'other';
    }
    return 'image';
  }

  if (resource.kind === 'video') {
    const videoCompatibleMime =
      !mime ||
      mime.startsWith('video/') ||
      mime === 'application/vnd.apple.mpegurl' ||
      mime === 'application/x-mpegurl' ||
      mime === 'application/dash+xml';
    return videoCompatibleMime ? 'video' : 'other';
  }

  if (resource.kind === 'other') {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
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

export function evaluateImagePreview(
  resource: ResourceRecord,
  appProtocol?: string,
): ImagePreviewDecision {
  const validated = validateExternalNavigationUrl(resource.url);
  if (!validated.safe || !validated.url) {
    return {
      canRenderImg: false,
      status: 'unsafe-url',
      note: 'URL gambar tidak valid atau menggunakan skema yang ditolak.',
    };
  }

  if (validated.host && isProhibitedHostname(validated.host)) {
    return {
      canRenderImg: false,
      status: 'restricted',
      note: 'Pratinjau gambar dinonaktifkan karena mengarah ke host lokal atau jaringan privat.',
    };
  }

  if (
    resource.observation === 'blocked' ||
    resource.classification === 'known-malicious' ||
    resource.classification === 'ad-or-tracker'
  ) {
    return {
      canRenderImg: false,
      status: 'restricted',
      note:
        resource.reason ||
        'Pratinjau otomatis dinonaktifkan karena aset ditandai atau diblokir oleh kebijakan filter.',
    };
  }

  const currentProtocol =
    appProtocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);
  if (currentProtocol === 'https:' && validated.url.startsWith('http://')) {
    return {
      canRenderImg: false,
      status: 'mixed-content',
      note: 'Pratinjau HTTP tidak dimuat otomatis di halaman HTTPS (konten campuran).',
    };
  }

  const rawMime = (resource.mimeType ?? '').trim().toLowerCase();
  const mime = rawMime.split(';')[0]?.trim() ?? '';
  const ext = getPathnameExtension(validated.url);

  if (
    mime === 'image/tiff' ||
    mime === 'image/x-tiff' ||
    UNSUPPORTED_RASTER_EXTS.has(ext)
  ) {
    return {
      canRenderImg: false,
      status: 'unsupported-format',
      note: 'Format gambar tidak didukung penuh untuk pratinjau langsung peramban.',
    };
  }

  return {
    canRenderImg: true,
    status: 'render-img',
  };
}

export function isSvgResource(resource: ResourceRecord): boolean {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = getPathnameExtension(resource.url);
  return mime === 'image/svg+xml' || ext === 'svg';
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

export function evaluatePdfPreview(
  resource: ResourceRecord,
  appProtocol?: string,
): PdfPreviewDecision {
  const validated = validateExternalNavigationUrl(resource.url);
  if (!validated.safe || !validated.url) {
    return {
      canRenderPdf: false,
      status: 'unsafe-url',
      note: 'URL PDF tidak valid atau menggunakan skema yang ditolak.',
    };
  }
  if (validated.host && isProhibitedHostname(validated.host)) {
    return {
      canRenderPdf: false,
      status: 'restricted',
      note: 'Pratinjau PDF dinonaktifkan karena mengarah ke host lokal atau jaringan privat.',
    };
  }
  if (
    resource.observation === 'blocked' ||
    resource.classification === 'known-malicious' ||
    resource.classification === 'ad-or-tracker'
  ) {
    return {
      canRenderPdf: false,
      status: 'restricted',
      note:
        resource.reason ||
        'Pratinjau PDF otomatis dinonaktifkan karena aset ditandai atau diblokir kebijakan filter.',
    };
  }
  const currentProtocol =
    appProtocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);
  if (currentProtocol === 'https:' && validated.url.startsWith('http://')) {
    return {
      canRenderPdf: false,
      status: 'mixed-content',
      note: 'PDF HTTP tidak dimuat otomatis di halaman HTTPS (konten campuran).',
    };
  }
  return { canRenderPdf: true, status: 'render-pdf' };
}

export function evaluateAudioPreview(
  resource: ResourceRecord,
  appProtocol?: string,
): AudioPreviewDecision {
  const validated = validateExternalNavigationUrl(resource.url);
  if (!validated.safe || !validated.url) {
    return {
      canRenderAudio: false,
      status: 'unsafe-url',
      note: 'URL audio tidak valid atau menggunakan skema yang ditolak.',
    };
  }
  if (validated.host && isProhibitedHostname(validated.host)) {
    return {
      canRenderAudio: false,
      status: 'restricted',
      note: 'Pratinjau audio dinonaktifkan karena mengarah ke host lokal atau privat.',
    };
  }
  if (
    resource.observation === 'blocked' ||
    resource.classification === 'known-malicious' ||
    resource.classification === 'ad-or-tracker'
  ) {
    return {
      canRenderAudio: false,
      status: 'restricted',
      note:
        resource.reason ||
        'Pratinjau audio dinonaktifkan karena aset ditandai kebijakan filter.',
    };
  }
  const currentProtocol =
    appProtocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);
  if (currentProtocol === 'https:' && validated.url.startsWith('http://')) {
    return {
      canRenderAudio: false,
      status: 'mixed-content',
      note: 'Audio HTTP tidak dimuat otomatis pada halaman HTTPS.',
    };
  }
  return { canRenderAudio: true, status: 'native-audio' };
}

export function evaluateVideoPreview(
  resource: ResourceRecord,
  appProtocol?: string,
): VideoPreviewDecision {
  const validated = validateExternalNavigationUrl(resource.url);
  if (!validated.safe || !validated.url) {
    return {
      canRenderVideo: false,
      status: 'unsafe-url',
      note: 'URL video tidak valid atau menggunakan skema yang ditolak.',
    };
  }

  if (validated.host && isProhibitedHostname(validated.host)) {
    return {
      canRenderVideo: false,
      status: 'restricted',
      note: 'Pratinjau video dinonaktifkan karena mengarah ke host lokal atau jaringan privat.',
    };
  }

  if (
    resource.observation === 'blocked' ||
    resource.classification === 'known-malicious' ||
    resource.classification === 'ad-or-tracker'
  ) {
    return {
      canRenderVideo: false,
      status: 'restricted',
      note:
        resource.reason ||
        'Pratinjau video dinonaktifkan karena aset ditandai atau diblokir oleh kebijakan inspeksi.',
    };
  }

  const currentProtocol =
    appProtocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);
  if (currentProtocol === 'https:' && validated.url.startsWith('http://')) {
    return {
      canRenderVideo: false,
      status: 'mixed-content',
      note: 'Video HTTP tidak dipratinjau otomatis pada halaman HTTPS.',
    };
  }

  const rawMime = (resource.mimeType ?? '').trim().toLowerCase();
  const baseMime = rawMime.split(';')[0]?.trim() ?? '';
  const ext = getPathnameExtension(validated.url);

  if (
    STREAM_MANIFEST_MIMES.has(baseMime) ||
    ext === 'm3u8' ||
    ext === 'mpd'
  ) {
    return {
      canRenderVideo: false,
      status: 'unsupported-stream',
      note: `Format ${baseMime || ext.toUpperCase()} merupakan manifest aliran terpisah yang memerlukan pemutar HLS/DASH khusus.`,
    };
  }

  if (shouldAttemptVideo(baseMime, validated.url)) {
    return {
      canRenderVideo: true,
      status: 'native-video',
    };
  }

  if (!baseMime) {
    return {
      canRenderVideo: false,
      status: 'unknown-mime',
      note: 'Tipe MIME video tidak diketahui dan ekstensi berkas bukan format video HTML5 standar.',
    };
  }

  return {
    canRenderVideo: false,
    status: 'unsupported-stream',
    note: `Format ${baseMime} tidak didukung pemutar video HTML langsung.`,
  };
}

export function isPlayableVideoCandidate(resource: ResourceRecord): boolean {
  return evaluateVideoPreview(resource).canRenderVideo;
}

