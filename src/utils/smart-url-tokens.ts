export const NON_URL_FILE_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'ogg',
  'ogv',
  'mov',
  'avi',
  'mkv',
  'm3u8',
  'mpd',
  'mp3',
  'wav',
  'flac',
  'aac',
  'm4a',
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'webp',
  'gif',
  'svg',
  'avif',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'json',
  'xml',
  'txt',
  'csv',
  'html',
  'htm',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'exe',
  'apk',
  'dmg',
  'iso',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
]);

const COMMON_MULTI_LABEL_TLDS = new Set([
  'co.id',
  'my.id',
  'ac.id',
  'or.id',
  'go.id',
  'web.id',
  'sch.id',
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.sg',
  'com.my',
  'com.br',
  'co.kr',
  'co.in',
]);

export const EXPLICIT_GLUED_EXTENSIONS_RE =
  /(\.(?:mp4|webm|mkv|mov|avi|m3u8|mpd|mp3|wav|jpg|jpeg|jfif|png|webp|gif|svg|avif|ico|pdf|html|htm|php|aspx|jsp|json|xml|css|js))(?=(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:[/?#:]|$))/gi;

export function precleanLine(rawLine: string): string {
  let line = rawLine
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

  // Defanged URL repair (hxxp/hxxps/[.])
  line = line
    .replace(/\bhxxps\s*:/gi, 'https:')
    .replace(/\bhxxp\s*:/gi, 'http:')
    .replace(/\[\.\]/g, '.')
    .replace(/\(\.\)/g, '.');

  // Repair broken spacing inside explicit schemes like "https : // alvareza.com" BEFORE // comment stripping
  line = line.replace(
    /\b(https?)\s*:\s*\/\s*\/\s*/gi,
    (_, scheme: string) => `${scheme.toLowerCase()}://`,
  );

  // Unwrap HTML quotes/markdown separators and inline // comments preceded by whitespace
  line = line
    .replace(/\]\(/g, ' ')
    .replace(/[<>"'`{}\t]+/g, ' ')
    .replace(/(^|\s)\/\/.*$/g, ' ')
    .replace(/([,;])(?=\s|$|(?:https?:\/\/)|(?:www\.))/gi, ' ');

  // Split glued bare-domain URLs after known file extensions (e.g. video.mp4alvareza.com/video.mp5)
  line = line.replace(EXPLICIT_GLUED_EXTENSIONS_RE, '$1 ');

  return line;
}

function splitGluedSchemes(token: string): string[] {
  const matches: number[] = [];
  const schemeRe = /https?:\/\//gi;
  let match: RegExpExecArray | null;
  while ((match = schemeRe.exec(token)) !== null) {
    if (match.index > 0) {
      matches.push(match.index);
    }
  }

  if (matches.length === 0) {
    return [token];
  }

  const splitPoints: number[] = [];
  for (const idx of matches) {
    const prevChar = token[idx - 1];
    // Preserve query-parameter nested URLs like ?next=https://... or ?https://... or &url=https://...
    if (prevChar === '=' || prevChar === '?' || prevChar === '&') {
      continue;
    }

    // Preserve explicit archive/wildcard paths like /web/*/https://...
    if (prevChar === '/') {
      const prefix = token.slice(0, idx);
      if (/\/web\/[^/]*\/$/i.test(prefix) || prefix.includes('*/')) {
        continue;
      }
    }

    splitPoints.push(idx);
  }

  if (splitPoints.length === 0) {
    return [token];
  }

  const parts: string[] = [];
  let start = 0;
  for (const point of splitPoints) {
    const slice = token.slice(start, point);
    if (slice) parts.push(slice);
    start = point;
  }
  const tail = token.slice(start);
  if (tail) parts.push(tail);
  return parts;
}

export function tokenizeLine(rawLine: string): string[] {
  const cleaned = precleanLine(rawLine);
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const token of rawTokens) {
    out.push(...splitGluedSchemes(token));
  }
  return out;
}

export function isDomainLikeHost(hostPart: string, hasPathOrQuery: boolean): boolean {
  const lower = hostPart.toLowerCase().replace(/:\d+$/, '');
  if (!lower || lower.includes('..') || lower.startsWith('.') || lower.endsWith('.')) {
    return false;
  }

  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  if (/^\[[0-9a-f:.%]+\]$/i.test(lower)) {
    return true;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower)) {
    return true;
  }

  if (!lower.includes('.')) {
    return false;
  }

  const labels = lower.split('.');
  const validLabels = labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith('-') &&
      !label.endsWith('-'),
  );
  if (!validLabels) return false;

  const tld = labels[labels.length - 1];
  if (!/^([a-z]{2,}|xn--[a-z0-9]+)$/i.test(tld)) {
    return false;
  }

  if (!hasPathOrQuery && !lower.startsWith('www.') && NON_URL_FILE_EXTENSIONS.has(tld)) {
    return false;
  }

  return true;
}

export function isTldLikeSuffix(dotSuffix: string): boolean {
  const cleaned = dotSuffix.replace(/^\./, '').split(/[/?#:]/)[0]?.toLowerCase() ?? '';
  if (!cleaned) return false;
  if (COMMON_MULTI_LABEL_TLDS.has(cleaned)) return true;
  return /^[a-z]{2,12}$/.test(cleaned) && !NON_URL_FILE_EXTENSIONS.has(cleaned);
}

export function isExplicitUrlToken(token: string): boolean {
  return (
    /^https?:\/\//i.test(token) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(token) ||
    /^(javascript|data|file|vbscript|mailto):/i.test(token)
  );
}
