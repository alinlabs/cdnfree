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

export type WebRenderMode = 'engine' | 'light';

export const ENGINE_FALLBACK_STORAGE_KEY = 'cdnfree:engine-fallback:v1';
export const ENGINE_FAILURE_THRESHOLD = 2;

export interface ResolvedProxyWebViewState {
  status: 'invalid-url' | 'unsupported-content' | 'embeddable-proxy';
  safeUrl: string | null;
  proxyUrl: string | null;
  engineUrl: string | null;
  defaultRenderMode: WebRenderMode;
  isXDomain: boolean;
  directAssetKind?: DirectAssetPreviewKind;
  directAssetUrl?: string | null;
  contentType?: string;
  host: string | null;
  heading: string;
  description: string;
  detailReason?: string;
  frameRestrictedUpstream?: boolean;
}

function getBrowserStorage(override?: Storage | null): Storage | null {
  if (override !== undefined) return override;
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readEngineFallbackMap(storage?: Storage | null): Record<string, number> {
  const store = getBrowserStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(ENGINE_FALLBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[k.toLowerCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeEngineFallbackMap(
  map: Record<string, number>,
  storage?: Storage | null,
): void {
  const store = getBrowserStorage(storage);
  if (!store) return;
  try {
    store.setItem(ENGINE_FALLBACK_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota / restricted storage errors
  }
}

export function getEngineHostFailures(
  host: string | null | undefined,
  storage?: Storage | null,
): number {
  const normalized = (host ?? '').trim().toLowerCase();
  if (!normalized) return 0;
  const map = readEngineFallbackMap(storage);
  return map[normalized] ?? 0;
}

export function recordEngineHostFailure(
  host: string | null | undefined,
  storage?: Storage | null,
): number {
  const normalized = (host ?? '').trim().toLowerCase();
  if (!normalized) return 0;
  const map = readEngineFallbackMap(storage);
  const nextCount = (map[normalized] ?? 0) + 1;
  map[normalized] = nextCount;
  writeEngineFallbackMap(map, storage);
  return nextCount;
}

export function clearEngineHostFailures(
  host: string | null | undefined,
  storage?: Storage | null,
): void {
  const normalized = (host ?? '').trim().toLowerCase();
  if (!normalized) return;
  const map = readEngineFallbackMap(storage);
  if (!(normalized in map)) return;
  delete map[normalized];
  writeEngineFallbackMap(map, storage);
}

export function shouldAutoFallbackToLight(
  host: string | null | undefined,
  storage?: Storage | null,
): boolean {
  return getEngineHostFailures(host, storage) >= ENGINE_FAILURE_THRESHOLD;
}

export function isXTwitterHost(host: string | null | undefined): boolean {
  const h = (host ?? '').trim().toLowerCase();
  return (
    h === 'x.com' ||
    h.endsWith('.x.com') ||
    h === 'twitter.com' ||
    h.endsWith('.twitter.com')
  );
}

export function isXTwitterUrl(rawUrl: string): boolean {
  try {
    return isXTwitterHost(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

export function buildXOembedUrl(postUrl: string): string {
  return `https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}`;
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
  options?: { bypassExternalLinks?: boolean; storage?: Storage | null },
): ResolvedProxyWebViewState {
  const validation = validateExternalNavigationUrl(finalUrl);
  if (!validation.safe || !validation.url) {
    return {
      status: 'invalid-url',
      safeUrl: null,
      proxyUrl: null,
      engineUrl: null,
      defaultRenderMode: 'engine',
      isXDomain: false,
      host: null,
      heading: 'Tampilan web tidak dapat dimuat',
      description:
        'Alamat tujuan tidak memenuhi syarat skema HTTP/HTTPS publik yang aman untuk dibuka di peramban.',
      detailReason: validation.reason,
    };
  }

  const host = validation.host ?? null;
  const isXDomain = isXTwitterHost(host);
  const encoded = encodeProxyUrlBrowser(validation.url);
  const bypassFlag = options?.bypassExternalLinks === false ? '0' : '1';
  const qs = `u=${encoded}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }&extbypass=${bypassFlag}`;
  const proxyUrl = `/api/proxy?${qs}`;
  const engineUrl = `/p/#${encodeURIComponent(validation.url)}`;
  const directAssetUrl = `/api/asset?u=${encoded}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;
  const defaultRenderMode: WebRenderMode = shouldAutoFallbackToLight(host, options?.storage)
    ? 'light'
    : 'engine';

  if (contentType && !isHtmlLikeContentType(contentType)) {
    const directKind = detectDirectPreviewKind(contentType, validation.url);
    if (directKind) {
      return {
        status: 'embeddable-proxy',
        safeUrl: validation.url,
        proxyUrl,
        engineUrl: null,
        defaultRenderMode: 'light',
        isXDomain,
        directAssetKind: directKind,
        directAssetUrl,
        contentType,
        host,
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
      engineUrl: null,
      defaultRenderMode,
      isXDomain,
      host,
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
    engineUrl,
    defaultRenderMode,
    isXDomain,
    contentType,
    host,
    heading: 'Tampilan situs (Mode Engine & Mode Ringan)',
    description:
      'Halaman dijalankan di Mode Engine berbasis Scramjet + Wisp atau dapat dialihkan ke Mode Ringan sesuai kebutuhan.',
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
