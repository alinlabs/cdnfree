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
): string {
  if (isLocalAppMediaUrl(targetUrl)) {
    return targetUrl;
  }
  const sid = resolveUsableSessionId(sessionId);
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sid ? `&sid=${encodeURIComponent(sid)}` : ''
  }`;
  return `/api/asset?${qs}`;
}

export function buildStreamAssetUrl(
  inspectionId: string,
  assetId: string,
): string {
  return `/api/assets/stream/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
}

export function buildHlsProxyUrl(
  inspectionId: string,
  assetId: string,
): string {
  return `/api/hls/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
}

export function isHlsResource(
  resource: Pick<ResourceRecord, 'assetKind' | 'hlsUrl'>,
): boolean {
  return (
    resource.assetKind === 'hls' ||
    Boolean(resource.hlsUrl?.startsWith('/api/hls/'))
  );
}

export function resolveInlineStreamUrl(
  resource: Pick<ResourceRecord, 'id' | 'url' | 'streamUrl' | 'hlsUrl' | 'assetKind' | 'source'>,
  inspectionId?: string,
): string {
  if (isLocalAppMediaUrl(resource.url)) {
    return resource.url;
  }
  if (resource.hlsUrl?.startsWith('/api/hls/')) {
    return resource.hlsUrl;
  }
  if (
    resource.assetKind === 'hls' &&
    inspectionId &&
    UUID_PATTERN.test(inspectionId) &&
    resource.id
  ) {
    return buildHlsProxyUrl(inspectionId, resource.id);
  }
  if (resource.streamUrl?.startsWith('/api/assets/stream/')) {
    return resource.streamUrl;
  }
  if (inspectionId && isServerStreamCandidate(resource, inspectionId)) {
    return buildStreamAssetUrl(inspectionId, resource.id);
  }
  return buildProxyAssetUrl(resource.url, inspectionId);
}

export function buildResilientImageCandidates(
  resource: Pick<
    ResourceRecord,
    'id' | 'url' | 'streamUrl' | 'classification' | 'source'
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
    pushUnique(resource.streamUrl);
  } else if (inspectionId && isServerStreamCandidate(resource, inspectionId)) {
    pushUnique(buildStreamAssetUrl(inspectionId, resource.id));
  }

  if (/^https?:\/\//i.test(resource.url)) {
    pushUnique(buildProxyAssetUrl(resource.url, inspectionId));
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
