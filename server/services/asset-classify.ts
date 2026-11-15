import type { AssetKind } from './asset-rules.ts';

export const GENERIC_MIMES = new Set([
  '',
  'text/plain',
  'application/octet-stream',
  'binary/octet-stream',
]);

export const EXT_KIND: Record<string, AssetKind> = {
  // Gambar raster
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  jfif: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  ico: 'image',
  bmp: 'image',
  heic: 'image',
  heif: 'image',
  apng: 'image',
  jxl: 'image',
  // Vektor
  svg: 'vector',
  svgz: 'vector',
  // Video
  mp4: 'video',
  webm: 'video',
  ogv: 'video',
  mov: 'video',
  m4v: 'video',
  mkv: 'video',
  avi: 'video',
  ts: 'video',
  m3u8: 'video',
  mpd: 'video',
  flv: 'video',
  wmv: 'video',
  '3gp': 'video',
  // Audio
  mp3: 'audio',
  ogg: 'audio',
  oga: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  opus: 'audio',
  weba: 'audio',
  aiff: 'audio',
  mid: 'audio',
  midi: 'audio',
  // Font
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  // Stylesheet
  css: 'stylesheet',
  // Dokumen / data terstruktur
  pdf: 'pdf',
  json: 'json',
  webmanifest: 'json',
};

export function normalizeMimeValue(rawMime?: string): string {
  if (!rawMime) return '';
  return rawMime.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isGenericMime(rawMime?: string): boolean {
  return GENERIC_MIMES.has(normalizeMimeValue(rawMime));
}

export function classifyMimeKind(rawMime?: string): AssetKind | null {
  const mime = normalizeMimeValue(rawMime);
  if (!mime || isGenericMime(mime)) return null;

  if (mime === 'image/svg+xml') return 'vector';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('video/') ||
    mime === 'application/vnd.apple.mpegurl' ||
    mime === 'application/x-mpegurl' ||
    mime === 'application/dash+xml'
  ) {
    return 'video';
  }
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime.startsWith('font/') ||
    mime === 'application/font-woff' ||
    mime === 'application/font-woff2' ||
    mime === 'application/vnd.ms-fontobject'
  ) {
    return 'font';
  }
  if (mime === 'text/css') return 'stylesheet';
  if (mime === 'application/pdf') return 'pdf';
  if (
    mime === 'application/json' ||
    mime === 'application/ld+json' ||
    mime === 'application/manifest+json'
  ) {
    return 'json';
  }

  return null;
}

export function extractUrlExtension(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const lastDot = pathname.lastIndexOf('.');
    const lastSlash = pathname.lastIndexOf('/');
    if (lastDot === -1 || lastDot < lastSlash) return '';
    return pathname.slice(lastDot + 1);
  } catch {
    return '';
  }
}

export function classifyAsset(params: {
  url: string;
  hint?: AssetKind;
  mime?: string;
  typeAttr?: string;
}): AssetKind {
  const byProbedMime = classifyMimeKind(params.mime);
  if (byProbedMime) return byProbedMime;

  const byTypeAttr = classifyMimeKind(params.typeAttr);
  if (byTypeAttr) return byTypeAttr;

  const ext = extractUrlExtension(params.url);
  if (ext && EXT_KIND[ext]) {
    return EXT_KIND[ext];
  }

  if (params.hint && params.hint !== 'other') {
    return params.hint;
  }

  return 'other';
}

const MEDIA_EXT_MIME_FALLBACK: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
};

export function normalizeMimeForAsset(rawUrl: string, rawMime?: string): string {
  const mime = normalizeMimeValue(rawMime);
  const ext = extractUrlExtension(rawUrl);

  if (ext === 'svg' || ext === 'svgz') {
    if (!mime || isGenericMime(mime) || mime === 'text/xml' || mime === 'application/xml') {
      return 'image/svg+xml; charset=utf-8';
    }
  }
  if (ext === 'pdf' && (!mime || isGenericMime(mime))) {
    return 'application/pdf';
  }
  if (MEDIA_EXT_MIME_FALLBACK[ext] && (!mime || isGenericMime(mime))) {
    return MEDIA_EXT_MIME_FALLBACK[ext];
  }

  return rawMime || mime || 'application/octet-stream';
}
