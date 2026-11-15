import type { ResourceRecord } from '../types/inspection.ts';
import { isLocalAppMediaUrl } from './local-media.ts';

export function encodeProxyUrlClient(absUrl: string): string {
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveUsableSessionId(sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  if (
    sessionId === 'bookmarks' ||
    sessionId.startsWith('bulk:') ||
    sessionId.startsWith('history:')
  ) {
    return undefined;
  }
  return sessionId;
}

function isServerStreamCandidate(
  resource: Pick<ResourceRecord, 'id' | 'source' | 'streamUrl'>,
  inspectionId?: string,
): boolean {
  if (resource.streamUrl?.startsWith('/api/assets/stream/')) {
    return true;
  }
  if (!inspectionId || !UUID_PATTERN.test(inspectionId) || !resource.id) {
    return false;
  }
  if (
    resource.source === 'browser-observed' ||
    resource.id.startsWith('dom-') ||
    resource.id.startsWith('cap-') ||
    resource.id.startsWith('bm-') ||
    resource.id.startsWith('hist-')
  ) {
    return false;
  }
  return true;
}

export function buildProxyFrameUrl(
  targetUrl: string,
  sessionId?: string,
): string {
  const sid = resolveUsableSessionId(sessionId);
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sid ? `&sid=${encodeURIComponent(sid)}` : ''
  }`;
  return `/api/proxy?${qs}`;
}

export function buildProxyAssetUrl(
  targetUrl: string,
  sessionId?: string,
  refererUrl?: string,
): string {
  if (isLocalAppMediaUrl(targetUrl)) {
    return targetUrl;
  }
  const sid = resolveUsableSessionId(sessionId);
  const safeRef =
    refererUrl && /^https?:\/\//i.test(refererUrl.trim())
      ? `&ref=${encodeProxyUrlClient(refererUrl.trim())}`
      : '';
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sid ? `&sid=${encodeURIComponent(sid)}` : ''
  }${safeRef}`;
  return `/api/asset?${qs}`;
}

function appendStatelessQuery(
  basePath: string,
  urlParamName: 'u' | 'src',
  resourceUrl?: string,
  refererUrl?: string,
): string {
  if (!resourceUrl || !/^https?:\/\//i.test(resourceUrl.trim())) {
    return basePath;
  }
  const hasParam = new RegExp(`[?&]${urlParamName}=`).test(basePath);
  const sep = basePath.includes('?') ? '&' : '?';
  let result = hasParam
    ? basePath
    : `${basePath}${sep}${urlParamName}=${encodeProxyUrlClient(resourceUrl.trim())}`;
  if (
    refererUrl &&
    /^https?:\/\//i.test(refererUrl.trim()) &&
    !/[?&]ref=/.test(result)
  ) {
    result += `${result.includes('?') ? '&' : '?'}ref=${encodeProxyUrlClient(refererUrl.trim())}`;
  }
  return result;
}

export function buildStreamAssetUrl(
  inspectionId: string,
  assetId: string,
  resourceUrl?: string,
  refererUrl?: string,
): string {
  const base = `/api/assets/stream/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
  return appendStatelessQuery(base, 'u', resourceUrl, refererUrl);
}

export function buildHlsProxyUrl(
  inspectionId: string,
  assetId: string,
  resourceUrl?: string,
  refererUrl?: string,
): string {
  const base = `/api/hls/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
  return appendStatelessQuery(base, 'src', resourceUrl, refererUrl);
}

export function isHlsResource(
  resource: Pick<ResourceRecord, 'assetKind' | 'hlsUrl' | 'url' | 'mimeType'>,
): boolean {
  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    resource.assetKind === 'hls' ||
    Boolean(resource.hlsUrl?.startsWith('/api/hls/')) ||
    Boolean(resource.hlsUrl?.startsWith('/smartcache/v1/hls/')) ||
    mime === 'application/vnd.apple.mpegurl' ||
    mime === 'application/x-mpegurl' ||
    /\.m3u8(?:$|[?#])/i.test(resource.url)
  );
}

export function resolveInlineStreamUrl(
  resource: Pick<
    ResourceRecord,
    'id' | 'url' | 'streamUrl' | 'hlsUrl' | 'assetKind' | 'source' | 'referer' | 'mimeType'
  >,
  inspectionId?: string,
): string {
  if (isLocalAppMediaUrl(resource.url)) {
    return resource.url;
  }
  if (resource.hlsUrl?.startsWith('/api/hls/')) {
    return appendStatelessQuery(
      resource.hlsUrl,
      'src',
      resource.url,
      resource.referer,
    );
  }
  if (
    resource.assetKind === 'hls' &&
    inspectionId &&
    UUID_PATTERN.test(inspectionId) &&
    resource.id
  ) {
    return buildHlsProxyUrl(
      inspectionId,
      resource.id,
      resource.url,
      resource.referer,
    );
  }
  if (resource.streamUrl?.startsWith('/api/assets/stream/')) {
    return appendStatelessQuery(
      resource.streamUrl,
      'u',
      resource.url,
      resource.referer,
    );
  }
  if (inspectionId && isServerStreamCandidate(resource, inspectionId)) {
    return buildStreamAssetUrl(
      inspectionId,
      resource.id,
      resource.url,
      resource.referer,
    );
  }
  return buildProxyAssetUrl(resource.url, inspectionId, resource.referer);
}

export function buildResilientImageCandidates(
  resource: Pick<
    ResourceRecord,
    'id' | 'url' | 'streamUrl' | 'classification' | 'source' | 'referer'
  >,
  inspectionId?: string,
): string[] {
  if (isLocalAppMediaUrl(resource.url)) {
    return [resource.url];
  }

  const candidates: string[] = [];
  const pushUnique = (url: string | null | undefined) => {
    if (!url || candidates.includes(url)) return;
    candidates.push(url);
  };

  if (resource.streamUrl?.startsWith('/api/assets/stream/')) {
    pushUnique(
      appendStatelessQuery(resource.streamUrl, 'u', resource.url, resource.referer),
    );
  } else if (inspectionId && isServerStreamCandidate(resource, inspectionId)) {
    pushUnique(
      buildStreamAssetUrl(
        inspectionId,
        resource.id,
        resource.url,
        resource.referer,
      ),
    );
  }

  if (/^https?:\/\//i.test(resource.url)) {
    pushUnique(buildProxyAssetUrl(resource.url, inspectionId, resource.referer));
  }

  if (
    /^https:\/\//i.test(resource.url) &&
    resource.classification !== 'known-malicious'
  ) {
    pushUnique(resource.url);
  }

  return candidates;
}

export function buildFullViewerUrl(
  targetUrl: string,
  sessionId?: string,
): string {
  const sid = resolveUsableSessionId(sessionId);
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sid ? `&sid=${encodeURIComponent(sid)}` : ''
  }`;
  return `/view?${qs}`;
}
