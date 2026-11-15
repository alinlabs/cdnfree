import type { ResourceRecord } from '../types/inspection.ts';
import { shouldAttemptVideo, STREAM_MANIFEST_MIMES } from './media-probe.ts';
import { isLocalAppMediaUrl } from './local-media.ts';
import { isProhibitedHostname } from './normalize-url.ts';
import { validateExternalNavigationUrl } from './safe-external-url.ts';

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
    | 'hls-stream'
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

const UNSUPPORTED_RASTER_EXTS = new Set(['tif', 'tiff', 'psd', 'raw']);
export const INLINE_STATIC_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MiB (gambar/vektor/font/css)
export const INLINE_STREAM_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB (streaming Range)

function getPathExt(rawUrl: string): string {
  try {
    const parsed =
      rawUrl.startsWith('/') && !rawUrl.startsWith('//')
        ? new URL(rawUrl, 'https://cdnfree.local')
        : new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    const dotIndex = pathname.lastIndexOf('.');
    const slashIndex = pathname.lastIndexOf('/');
    if (dotIndex === -1 || dotIndex < slashIndex) return '';
    return pathname.slice(dotIndex + 1);
  } catch {
    return '';
  }
}

export function isAssetOverInlineLimit(resource: ResourceRecord): boolean {
  if (
    typeof resource.declaredBytes !== 'number' ||
    !Number.isFinite(resource.declaredBytes)
  ) {
    return false;
  }
  const baseMime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    resource.kind === 'video' ||
    resource.kind === 'audio' ||
    resource.assetKind === 'video' ||
    resource.assetKind === 'audio' ||
    resource.assetKind === 'hls' ||
    resource.assetKind === 'dash' ||
    baseMime.startsWith('video/') ||
    baseMime.startsWith('audio/') ||
    shouldAttemptVideo(baseMime, resource.url)
  ) {
    return false;
  }
  return resource.declaredBytes > INLINE_STATIC_LIMIT_BYTES;
}

export function isUnverifiedAsset(resource: ResourceRecord): boolean {
  return resource.probe?.status === 'unverified';
}

export function evaluateImagePreview(
  resource: ResourceRecord,
  appProtocol?: string,
): ImagePreviewDecision {
  const isLocalMedia = isLocalAppMediaUrl(resource.url);
  let targetUrl = resource.url.trim();

  if (!isLocalMedia) {
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
    targetUrl = validated.url;
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
  if (currentProtocol === 'https:' && targetUrl.startsWith('http://')) {
    return {
      canRenderImg: false,
      status: 'mixed-content',
      note: 'Pratinjau HTTP tidak dimuat otomatis di halaman HTTPS (konten campuran).',
    };
  }

  const rawMime = (resource.mimeType ?? '').trim().toLowerCase();
  const mime = rawMime.split(';')[0]?.trim() ?? '';
  const ext = getPathExt(targetUrl);

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
  const isLocalMedia = isLocalAppMediaUrl(resource.url);
  let targetUrl = resource.url.trim();

  if (!isLocalMedia) {
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
    targetUrl = validated.url;
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

  if (
    resource.assetKind === 'wrapper' ||
    resource.probe?.reason === 'html-wrapper'
  ) {
    return {
      canRenderVideo: false,
      status: 'restricted',
      note: 'URL mengarah ke halaman pembungkus HTML, bukan file video langsung.',
    };
  }

  if (
    resource.assetKind === 'hls' ||
    Boolean(resource.hlsUrl?.startsWith('/api/hls/'))
  ) {
    return {
      canRenderVideo: true,
      status: 'hls-stream',
    };
  }

  const currentProtocol =
    appProtocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);
  if (currentProtocol === 'https:' && targetUrl.startsWith('http://')) {
    return {
      canRenderVideo: false,
      status: 'mixed-content',
      note: 'Video HTTP tidak dipratinjau otomatis pada halaman HTTPS.',
    };
  }

  const rawMime = (resource.mimeType ?? '').trim().toLowerCase();
  const baseMime = rawMime.split(';')[0]?.trim() ?? '';
  const ext = getPathExt(targetUrl);

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

  if (shouldAttemptVideo(baseMime, targetUrl)) {
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
