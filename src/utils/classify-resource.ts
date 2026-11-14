export type ResourceKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'script'
  | 'stylesheet'
  | 'font'
  | 'document'
  | 'other';

export type ResourceSource =
  | 'html-img'
  | 'html-video'
  | 'html-audio'
  | 'html-script'
  | 'html-link'
  | 'html-source'
  | 'css-reference'
  | 'browser-observed';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tiff',
]);
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'ogg', 'ogv', 'm3u8', 'mpd', 'mov', 'm4v', 'ts',
]);
const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'aac', 'm4a', 'oga', 'flac', 'opus',
]);
const SCRIPT_EXTS = new Set(['js', 'mjs', 'cjs']);
const STYLESHEET_EXTS = new Set(['css']);
const FONT_EXTS = new Set(['woff', 'woff2', 'ttf', 'otf', 'eot']);
const DOCUMENT_EXTS = new Set(['html', 'htm', 'xhtml', 'pdf', 'xml']);

function extractExtension(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    const lastDot = pathname.lastIndexOf('.');
    const lastSlash = pathname.lastIndexOf('/');
    if (lastDot === -1 || lastDot < lastSlash) return '';
    return pathname.slice(lastDot + 1);
  } catch {
    return '';
  }
}

export function classifyResourceKind(
  rawUrl: string,
  options?: {
    source?: ResourceSource;
    rel?: string;
    asHint?: string;
    mimeHint?: string;
  },
): ResourceKind {
  const rawMime = (options?.mimeHint ?? '').toLowerCase().trim();
  const mime = rawMime.split(';')[0]?.trim() ?? '';
  const asHint = (options?.asHint ?? '').toLowerCase();
  const rel = (options?.rel ?? '').toLowerCase();
  const ext = extractExtension(rawUrl);

  if (mime.startsWith('image/') || asHint === 'image') return 'image';
  if (mime.startsWith('video/') || asHint === 'video') return 'video';
  if (mime.startsWith('audio/') || asHint === 'audio') return 'audio';
  if (mime.includes('javascript') || asHint === 'script') return 'script';
  if (mime === 'text/css' || asHint === 'style' || rel.includes('stylesheet')) {
    return 'stylesheet';
  }
  if (mime.startsWith('font/') || asHint === 'font') return 'font';
  if (mime === 'text/html' || mime === 'application/pdf' || asHint === 'document') {
    return 'document';
  }

  if (ext) {
    if (FONT_EXTS.has(ext)) return 'font';
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (SCRIPT_EXTS.has(ext)) return 'script';
    if (STYLESHEET_EXTS.has(ext)) return 'stylesheet';
    if (DOCUMENT_EXTS.has(ext)) return 'document';
  }

  if (options?.source === 'html-img') return 'image';
  if (options?.source === 'html-video') return 'video';
  if (options?.source === 'html-audio') return 'audio';
  if (options?.source === 'html-script') return 'script';
  if (rel.includes('icon')) return 'image';

  return 'other';
}

export function inferMimeHintFromUrl(rawUrl: string): string | undefined {
  const ext = extractExtension(rawUrl);
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    gif: 'image/gif',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    webm: 'video/webm',
    m3u8: 'application/vnd.apple.mpegurl',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    pdf: 'application/pdf',
  };
  return ext ? map[ext] : undefined;
}

const CDN_HOST_RULES: Array<{ suffix: string; provider: string }> = [
  { suffix: 'cloudfront.net', provider: 'Amazon CloudFront' },
  { suffix: 'cdnjs.cloudflare.com', provider: 'Cloudflare' },
  { suffix: 'cloudflare.com', provider: 'Cloudflare' },
  { suffix: 'cloudflareinsights.com', provider: 'Cloudflare' },
  { suffix: 'fastly.net', provider: 'Fastly' },
  { suffix: 'fastlylb.net', provider: 'Fastly' },
  { suffix: 'akamaihd.net', provider: 'Akamai' },
  { suffix: 'akamaized.net', provider: 'Akamai' },
  { suffix: 'edgesuite.net', provider: 'Akamai' },
  { suffix: 'jsdelivr.net', provider: 'jsDelivr' },
  { suffix: 'unpkg.com', provider: 'unpkg' },
  { suffix: 'ajax.googleapis.com', provider: 'Google Hosted Libraries' },
  { suffix: 'fonts.googleapis.com', provider: 'Google Fonts' },
  { suffix: 'storage.googleapis.com', provider: 'Google Cloud Storage' },
  { suffix: 'gstatic.com', provider: 'Google' },
  { suffix: 'googleusercontent.com', provider: 'Google' },
  { suffix: 'azureedge.net', provider: 'Azure CDN' },
  { suffix: 'msecnd.net', provider: 'Azure CDN' },
  { suffix: 'b-cdn.net', provider: 'BunnyCDN' },
  { suffix: 'vercel-dns.com', provider: 'Vercel' },
  { suffix: 'netlify.app', provider: 'Netlify' },
];

export function detectCdnProvider(hostname: string): string | null {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  for (const rule of CDN_HOST_RULES) {
    if (lower === rule.suffix || lower.endsWith(`.${rule.suffix}`)) {
      return rule.provider;
    }
  }
  return null;
}
