import type { InspectionResult } from '../types/inspection.ts';
import { validateExternalNavigationUrl } from './safe-external-url.ts';

export type WebViewStatus =
  | 'invalid-url'
  | 'denied-by-policy'
  | 'unsupported-content'
  | 'mixed-content-blocked'
  | 'embeddable-sandbox';

export interface ResolvedWebViewState {
  status: WebViewStatus;
  safeUrl: string | null;
  host: string | null;
  heading: string;
  description: string;
  detailReason?: string;
}

function isHtmlLikeContentType(contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase();
  return (
    normalized.includes('text/html') ||
    normalized.includes('application/xhtml+xml')
  );
}

export function resolveWebViewState(
  finalUrl: string,
  preview: InspectionResult['preview'],
  contentType?: string,
  appProtocol?: string,
): ResolvedWebViewState {
  const validation = validateExternalNavigationUrl(finalUrl);
  if (!validation.safe || !validation.url) {
    return {
      status: 'invalid-url',
      safeUrl: null,
      host: null,
      heading: 'Tampilan web tidak dapat dimuat',
      description:
        'Alamat tujuan tidak memenuhi syarat skema HTTP/HTTPS publik yang aman untuk dibuka di peramban.',
      detailReason: validation.reason,
    };
  }

  if (preview.mode === 'external-only') {
    return {
      status: 'denied-by-policy',
      safeUrl: validation.url,
      host: validation.host ?? null,
      heading: 'Situs menolak penyematan langsung',
      description:
        'Pemilik situs melarang halaman ini ditampilkan di dalam frame pihak ketiga. CDNFREE menghormati kebijakan keamanan tersebut dan tidak melewatinya.',
      detailReason: preview.reason,
    };
  }

  if (
    preview.mode === 'unsupported' ||
    (contentType && !isHtmlLikeContentType(contentType))
  ) {
    return {
      status: 'unsupported-content',
      safeUrl: validation.url,
      host: validation.host ?? null,
      heading: 'Format konten tidak didukung untuk tampilan web',
      description:
        'Respons akhir bukan halaman HTML standar yang dapat ditampilkan di tampilan web tersemat.',
      detailReason:
        preview.reason ||
        (contentType ? `Tipe konten terdeteksi: ${contentType}` : undefined),
    };
  }

  const currentProtocol =
    appProtocol ??
    (typeof window !== 'undefined' ? window.location.protocol : undefined);

  if (currentProtocol === 'https:' && validation.url.startsWith('http://')) {
    return {
      status: 'mixed-content-blocked',
      safeUrl: validation.url,
      host: validation.host ?? null,
      heading: 'Diblokir oleh kebijakan konten campuran peramban',
      description:
        'CDNFREE berjalan melalui HTTPS sementara situs tujuan masih menggunakan HTTP polos, sehingga peramban menolak penyematan frame secara otomatis.',
    };
  }

  return {
    status: 'embeddable-sandbox',
    safeUrl: validation.url,
    host: validation.host ?? null,
    heading: 'Tampilan situs (sandbox)',
    description:
      'Situs dimuat langsung oleh peramban di dalam sandbox terisolasi tanpa akses ke kuki atau penyimpanan CDNFREE.',
  };
}

export type DirectAssetPreviewKind =
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'font'
  | 'text';

export interface ResolvedProxyWebViewState {
  status: 'invalid-url' | 'unsupported-content' | 'embeddable-proxy';
  safeUrl: string | null;
  proxyUrl: string | null;
  directAssetKind?: DirectAssetPreviewKind;
  directAssetUrl?: string | null;
  contentType?: string;
  host: string | null;
  heading: string;
  description: string;
  detailReason?: string;
  frameRestrictedUpstream?: boolean;
}

function detectDirectPreviewKind(
  contentType: string | undefined,
  url: string,
): DirectAssetPreviewKind | null {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const lowerUrl = url.toLowerCase();
  if (
    mime.startsWith('image/') ||
    /\.(?:svg|png|jpe?g|webp|avif|gif|ico|bmp)(?:$|[?#])/.test(lowerUrl)
  ) {
    return 'image';
  }
  if (mime === 'application/pdf' || /\.pdf(?:$|[?#])/.test(lowerUrl)) {
    return 'pdf';
  }
  if (
    mime.startsWith('video/') ||
    /\.(?:mp4|webm|ogv)(?:$|[?#])/.test(lowerUrl)
  ) {
    return 'video';
  }
  if (
    mime.startsWith('audio/') ||
    /\.(?:mp3|wav|m4a|ogg|oga|flac|opus)(?:$|[?#])/.test(lowerUrl)
  ) {
    return 'audio';
  }
  if (
    mime.startsWith('font/') ||
    mime === 'application/font-woff' ||
    mime === 'application/font-woff2' ||
    /\.(?:woff2?|ttf|otf)(?:$|[?#])/.test(lowerUrl)
  ) {
    return 'font';
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime.includes('javascript') ||
    mime.includes('ecmascript') ||
    /\.(?:css|js|mjs|json|xml|txt|csv)(?:$|[?#])/.test(lowerUrl)
  ) {
    return 'text';
  }
  return null;
}

export function resolveProxyWebViewState(
  finalUrl: string,
  preview: InspectionResult['preview'],
  contentType?: string,
  sessionId?: string,
  options?: { bypassExternalLinks?: boolean },
): ResolvedProxyWebViewState {
  const validation = validateExternalNavigationUrl(finalUrl);
  if (!validation.safe || !validation.url) {
    return {
      status: 'invalid-url',
      safeUrl: null,
      proxyUrl: null,
      host: null,
      heading: 'Tampilan web tidak dapat dimuat',
      description:
        'Alamat tujuan tidak memenuhi syarat skema HTTP/HTTPS publik yang aman untuk dibuka di peramban.',
      detailReason: validation.reason,
    };
  }

  const encoded = encodeProxyUrlBrowser(validation.url);
  const bypassFlag = options?.bypassExternalLinks === false ? '0' : '1';
  const qs = `u=${encoded}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }&extbypass=${bypassFlag}`;
  const proxyUrl = `/api/proxy?${qs}`;
  const directAssetUrl = `/api/asset?u=${encoded}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;

  if (contentType && !isHtmlLikeContentType(contentType)) {
    const directKind = detectDirectPreviewKind(contentType, validation.url);
    if (directKind) {
      return {
        status: 'embeddable-proxy',
        safeUrl: validation.url,
        proxyUrl,
        directAssetKind: directKind,
        directAssetUrl,
        contentType,
        host: validation.host ?? null,
        heading: `Pratinjau langsung (${contentType})`,
        description:
          'Berkas target dimuat aman melalui proxy same-origin CDNFREE agar dapat langsung dipratinjau.',
        detailReason: preview.reason,
      };
    }
  }

  if (
    preview.mode === 'unsupported' ||
    (contentType && !isHtmlLikeContentType(contentType))
  ) {
    return {
      status: 'unsupported-content',
      safeUrl: validation.url,
      proxyUrl: null,
      host: validation.host ?? null,
      heading: 'Format konten tidak didukung untuk tampilan web',
      description:
        'Respons akhir bukan halaman HTML standar yang dapat ditampilkan di tampilan web tersemat.',
      detailReason:
        preview.reason ||
        (contentType ? `Tipe konten terdeteksi: ${contentType}` : undefined),
    };
  }

  return {
    status: 'embeddable-proxy',
    safeUrl: validation.url,
    proxyUrl,
    contentType,
    host: validation.host ?? null,
    heading: 'Tampilan situs (proxy)',
    description:
      'Halaman disajikan melalui proxy same-origin CDNFREE agar situs modern tetap dapat dimuat dan aset runtime ikut tertangkap.',
    detailReason: preview.reason,
    frameRestrictedUpstream: preview.mode === 'external-only',
  };
}

function encodeProxyUrlBrowser(absUrl: string): string {
  const bytes = new TextEncoder().encode(absUrl);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
