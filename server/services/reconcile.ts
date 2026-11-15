import { refineMime, type SniffedKind } from './content-sniff.ts';

export type DeclaredKind =
  | 'html'
  | 'video'
  | 'audio'
  | 'image'
  | 'pdf'
  | 'font'
  | 'json'
  | 'other';

export function kindFromMime(mime: string | null | undefined): DeclaredKind | null {
  if (!mime) return null;
  const m = mime.split(';')[0].trim().toLowerCase();
  if (!m) return null;
  if (m === 'text/html' || m === 'application/xhtml+xml') return 'html';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('font/') || m.includes('woff') || m === 'application/vnd.ms-fontobject') {
    return 'font';
  }
  if (m.includes('json')) return 'json';
  return 'other';
}

const MEDIA_URL_EXT_RE =
  /\.(mp4|m4v|webm|mov|avi|mkv|ts|mp3|m4a|wav|ogg|flac|aac|jpg|jpeg|png|webp|gif|avif|svg|ico|bmp|pdf|m3u8|mpd|woff2?|ttf|otf|eot)(?:$|[?#])/i;

export function kindFromUrlExtension(rawUrl: string | null | undefined): DeclaredKind | null {
  if (!rawUrl) return null;
  const m = MEDIA_URL_EXT_RE.exec(rawUrl);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (['mp4', 'm4v', 'webm', 'mov', 'avi', 'mkv', 'ts', 'm3u8', 'mpd'].includes(ext)) {
    return 'video';
  }
  if (['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'ico', 'bmp'].includes(ext)) {
    return 'image';
  }
  if (ext === 'pdf') return 'pdf';
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
  return null;
}

export interface ReconcileResult {
  kind: DeclaredKind | 'hls' | 'dash' | 'binary' | 'empty';
  mime: string | null;
  /** true bila body HTML tapi header atau ekstensi URL mengklaim media. */
  wrapper: boolean;
  lowConfidence: boolean;
}

export function reconcile(
  declaredMime: string | null | undefined,
  sniffed: SniffedKind,
  rawUrl?: string,
  buf?: Buffer,
): ReconcileResult {
  if (sniffed === 'html') {
    const declaredFromHeader = kindFromMime(declaredMime);
    const declaredFromUrl = kindFromUrlExtension(rawUrl);
    const claimsMediaHeader =
      declaredFromHeader !== null &&
      declaredFromHeader !== 'html' &&
      declaredFromHeader !== 'other';
    const claimsMediaUrl = declaredFromUrl !== null;
    return {
      kind: 'html',
      mime: 'text/html; charset=utf-8',
      wrapper: claimsMediaHeader || claimsMediaUrl,
      lowConfidence: false,
    };
  }

  if (sniffed === 'hls' || sniffed === 'dash') {
    return {
      kind: sniffed,
      mime: buf ? refineMime(sniffed, buf) : mimeOf(sniffed),
      wrapper: false,
      lowConfidence: false,
    };
  }

  if (
    sniffed === 'video' ||
    sniffed === 'audio' ||
    sniffed === 'image' ||
    sniffed === 'pdf' ||
    sniffed === 'font'
  ) {
    return {
      kind: sniffed,
      mime: buf ? refineMime(sniffed, buf) : mimeOf(sniffed),
      wrapper: false,
      lowConfidence: false,
    };
  }

  const declared = kindFromMime(declaredMime) ?? kindFromUrlExtension(rawUrl);
  return {
    kind: declared ?? (sniffed === 'empty' ? 'empty' : 'binary'),
    mime: declaredMime?.split(';')[0].trim().toLowerCase() ?? null,
    wrapper: false,
    lowConfidence: true,
  };
}

const mimeOf = (k: SniffedKind): string =>
  k === 'hls'
    ? 'application/vnd.apple.mpegurl'
    : k === 'dash'
      ? 'application/dash+xml'
      : k === 'video'
        ? 'video/mp4'
        : k === 'audio'
          ? 'audio/mpeg'
          : k === 'image'
            ? 'image/jpeg'
            : k === 'pdf'
              ? 'application/pdf'
              : 'application/octet-stream';
