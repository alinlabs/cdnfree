import { buildProxyAssetUrl } from './proxy-url.ts';

const VIDEO_EXT_REGEX = /\.(mp4|m4v|webm|ogv|ogg|mov)(?:$|[?#])/i;
const KNOWN_PLAYABLE_VIDEO_MIME = /^video\/(mp4|webm|ogg|quicktime|x-m4v)$/i;
export const STREAM_MANIFEST_MIMES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/dash+xml',
]);

export interface MediaProbeResult {
  ok: boolean;
  status: number;
  contentType: string;
  acceptRanges: string | null;
  totalBytes: number;
}

export function shouldAttemptVideo(mime: string, url: string): boolean {
  const baseMime = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (STREAM_MANIFEST_MIMES.has(baseMime) || /\.(m3u8|mpd)(?:$|[?#])/i.test(url)) {
    return false;
  }
  if (KNOWN_PLAYABLE_VIDEO_MIME.test(baseMime)) return true;
  if (/^video\//i.test(baseMime)) return true;
  if (
    !baseMime ||
    /^(application\/octet-stream|binary\/octet-stream)$/i.test(baseMime)
  ) {
    return VIDEO_EXT_REGEX.test(url);
  }
  return false;
}

export async function probeMedia(
  url: string,
  sessionId?: string,
): Promise<MediaProbeResult> {
  const proxyUrl = `${buildProxyAssetUrl(url, sessionId)}&probe=1`;
  const r = await fetch(proxyUrl, {
    method: 'HEAD',
    headers: { range: 'bytes=0-1' },
  });
  const contentRange = r.headers.get('content-range');
  const rangeTotal = contentRange?.split('/')[1];
  const rawLen = rangeTotal ?? r.headers.get('content-length') ?? '0';
  const parsedBytes = Number(rawLen);
  return {
    ok: r.ok || r.status === 206,
    status: r.status,
    contentType: r.headers.get('content-type') ?? '',
    acceptRanges: r.headers.get('accept-ranges'),
    totalBytes: Number.isFinite(parsedBytes) && parsedBytes > 0 ? parsedBytes : 0,
  };
}
