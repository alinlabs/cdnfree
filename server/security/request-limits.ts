export const REQUEST_TIMEOUT_MS = 8_000;
export const ASSET_DOWNLOAD_TIMEOUT_MS = 12_000;
export const MAX_REDIRECT_HOPS = 8;
export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MiB limit for compressed & decompressed HTML in inspection
export const MAX_ASSET_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap for public asset downloads
export const PROXY_LIMITS = {
  html: 8 * 1024 * 1024,
  text: 1 * 1024 * 1024,
  media: Infinity,
} as const;
export const MAX_CONCURRENT_INSPECTIONS = 8;
export const MAX_CONCURRENT_DOWNLOADS = 4;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;

const ALLOWED_HTML_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
]);

const DANGEROUS_DOWNLOAD_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'application/x-bat',
  'application/x-csh',
  'application/vnd.microsoft.portable-executable',
  'application/java-archive',
  'application/hta',
  'text/vbscript',
]);

const SAFE_EXACT_DOWNLOAD_MIMES = new Set([
  'text/css',
  'application/font-woff',
  'application/font-woff2',
  'application/vnd.ms-fontobject',
  'application/pdf',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/vnd.ms-fontobject': 'eot',
  'text/css': 'css',
  'application/pdf': 'pdf',
};

export function parseMimeType(contentTypeHeader: string | undefined): string {
  if (!contentTypeHeader) return '';
  return contentTypeHeader.split(';')[0].trim().toLowerCase();
}

export function isAllowedHtmlContentType(contentTypeHeader: string | undefined): boolean {
  const mime = parseMimeType(contentTypeHeader);
  return ALLOWED_HTML_MIME_TYPES.has(mime);
}

const DIRECT_TEXT_INSPECTABLE_MIMES = new Set([
  'application/pdf',
  'text/css',
  'text/plain',
  'text/csv',
  'text/xml',
  'application/xml',
  'application/json',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/font-woff',
  'application/font-woff2',
  'application/vnd.ms-fontobject',
]);

const EXTENSION_MIME_FALLBACK: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
};

export function isDirectInspectableAssetContentType(
  contentTypeHeader: string | undefined,
  rawUrl?: string,
): string | null {
  const mime = parseMimeType(contentTypeHeader);
  if (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('font/') ||
    DIRECT_TEXT_INSPECTABLE_MIMES.has(mime)
  ) {
    return mime;
  }

  if (
    rawUrl &&
    (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream')
  ) {
    try {
      const pathname = new URL(rawUrl).pathname.toLowerCase();
      const dot = pathname.lastIndexOf('.');
      const slash = pathname.lastIndexOf('/');
      if (dot > slash && dot !== -1) {
        const ext = pathname.slice(dot + 1);
        if (EXTENSION_MIME_FALLBACK[ext]) {
          return EXTENSION_MIME_FALLBACK[ext];
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function isSafeDownloadContentType(contentTypeHeader: string | undefined): boolean {
  const mime = parseMimeType(contentTypeHeader);
  if (!mime) return false;
  if (DANGEROUS_DOWNLOAD_MIMES.has(mime)) return false;
  if (
    mime.includes('javascript') ||
    mime.includes('ecmascript') ||
    mime.includes('executable') ||
    mime.includes('msdownload')
  ) {
    return false;
  }

  if (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('font/') ||
    SAFE_EXACT_DOWNLOAD_MIMES.has(mime)
  ) {
    return true;
  }

  return false;
}

export function inferExtensionFromMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? 'bin';
}

export function sanitizeDownloadFilename(
  rawUrl: string,
  mimeType: string,
  fallbackId = 'aset',
): string {
  let candidate = '';
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? '';
    candidate = decodeURIComponent(lastSegment);
  } catch {
    candidate = '';
  }

  // Strip directory traversal, control bytes, header delimiters, and unsafe filename characters
  let cleaned = candidate
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|;]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.\.+/g, '.')
    .trim();

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    cleaned = `cdnfree-${fallbackId}`;
  }

  if (cleaned.length > 100) {
    const extIdx = cleaned.lastIndexOf('.');
    const ext = extIdx > 0 ? cleaned.slice(extIdx, extIdx + 12) : '';
    const stem = cleaned.slice(0, 100 - ext.length);
    cleaned = `${stem}${ext}`;
  }

  if (!/\.[a-z0-9]{1,8}$/i.test(cleaned)) {
    const inferredExt = inferExtensionFromMime(mimeType);
    cleaned = `${cleaned}.${inferredExt}`;
  }

  // Never output dangerous executable extensions even if upstream MIME was valid
  if (/\.(exe|bat|cmd|com|msi|scr|ps1|sh|vbs|js|mjs|cjs|html|htm|hta)$/i.test(cleaned)) {
    const inferredExt = inferExtensionFromMime(mimeType);
    cleaned = `${cleaned.replace(/\.[^.]+$/, '')}.${inferredExt}`;
  }

  return cleaned;
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = MAX_CONCURRENT_INSPECTIONS) {
    this.maxConcurrent = maxConcurrent;
  }

  tryAcquire(): boolean {
    if (this.active >= this.maxConcurrent) {
      return false;
    }
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(
    windowMs = RATE_LIMIT_WINDOW_MS,
    maxRequests = RATE_LIMIT_MAX_REQUESTS,
  ) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = this.buckets.get(key) ?? [];
    const recent = existing.filter((ts) => ts > cutoff);

    if (recent.length >= this.maxRequests) {
      this.buckets.set(key, recent);
      return false;
    }

    recent.push(now);
    this.buckets.set(key, recent);

    // Periodic pruning when map grows large
    if (this.buckets.size > 1000) {
      for (const [k, timestamps] of this.buckets.entries()) {
        if (timestamps.every((ts) => ts <= cutoff)) {
          this.buckets.delete(k);
        }
      }
    }

    return true;
  }
}
