import type { ResourceRecord } from '../types/inspection.ts';
import type {
  VideoPlaybackSnapshot,
  VideoSourceMode,
} from '../services/video-playback-store.ts';
import { isLocalAppMediaUrl } from './local-media.ts';
import { isHlsResource, resolveInlineStreamUrl } from './proxy-url.ts';

export interface VideoSourcePlan {
  initialMode: VideoSourceMode;
  activeSrc: string | undefined;
  streamSrc: string;
  hlsSrc: string | null;
  isHls: boolean;
  canFallbackToStream: boolean;
  isOfflineCached: boolean;
}

export interface ResolveVideoSourceInput {
  resource: Pick<
    ResourceRecord,
    'id' | 'url' | 'source' | 'referer' | 'probe' | 'assetKind' | 'hlsUrl' | 'streamUrl'
  >;
  inspectionId?: string;
  smartCacheKey: string;
  isCachedOffline?: boolean;
  cachedMediaUrl?: string | null;
  snapshot?: Pick<VideoPlaybackSnapshot, 'preferredSourceMode' | 'directFailed'> | null;
}

export function buildSmartCacheMediaUrl(smartCacheKey: string): string {
  return `/smartcache/v1/media?key=${encodeURIComponent(smartCacheKey)}`;
}

export function buildSmartCacheHlsUrl(smartCacheKey: string): string {
  return `/smartcache/v1/hls/${encodeURIComponent(smartCacheKey)}/index.m3u8`;
}

export function shouldPreferStreamInitially(
  resource: Pick<
    ResourceRecord,
    'url' | 'source' | 'referer' | 'probe' | 'streamUrl'
  >,
  snapshot?: Pick<VideoPlaybackSnapshot, 'preferredSourceMode' | 'directFailed'> | null,
): boolean {
  if (isLocalAppMediaUrl(resource.url)) {
    return false;
  }
  if (snapshot?.preferredSourceMode === 'stream' || snapshot?.directFailed) {
    return true;
  }
  if (snapshot?.preferredSourceMode === 'direct') {
    return false;
  }
  if (Boolean(resource.referer)) {
    return true;
  }
  if (resource.source === 'browser-observed') {
    return true;
  }
  if (
    resource.probe &&
    (resource.probe.status === 'unverified' || resource.probe.httpStatus === 403)
  ) {
    return true;
  }
  return !/^https?:\/\//i.test(resource.url);
}

export function resolveVideoSourcePlan({
  resource,
  inspectionId,
  smartCacheKey,
  isCachedOffline = false,
  cachedMediaUrl = null,
  snapshot = null,
}: ResolveVideoSourceInput): VideoSourcePlan {
  const streamSrc = resolveInlineStreamUrl(resource, inspectionId);
  const hlsCandidate = isHlsResource(resource);

  // 1. Offline SmartCache has highest priority (0ms local playback)
  if (isCachedOffline && smartCacheKey) {
    if (hlsCandidate) {
      const hlsCacheUrl = cachedMediaUrl || buildSmartCacheHlsUrl(smartCacheKey);
      return {
        initialMode: 'cache',
        activeSrc: undefined,
        streamSrc,
        hlsSrc: hlsCacheUrl,
        isHls: true,
        canFallbackToStream: false,
        isOfflineCached: true,
      };
    }
    const cacheUrl = cachedMediaUrl || buildSmartCacheMediaUrl(smartCacheKey);
    return {
      initialMode: 'cache',
      activeSrc: cacheUrl,
      streamSrc,
      hlsSrc: null,
      isHls: false,
      canFallbackToStream: true,
      isOfflineCached: true,
    };
  }

  // 2. Online HLS stream (/api/hls/... or /api/asset?... for bookmarked HLS)
  if (hlsCandidate) {
    return {
      initialMode: 'hls',
      activeSrc: undefined,
      streamSrc,
      hlsSrc: streamSrc,
      isHls: true,
      canFallbackToStream: false,
      isOfflineCached: false,
    };
  }

  // 3. Bundled local app media (/assets/*.mp4, /logo.webp, etc.)
  if (isLocalAppMediaUrl(resource.url)) {
    return {
      initialMode: 'direct',
      activeSrc: resource.url,
      streamSrc: resource.url,
      hlsSrc: null,
      isHls: false,
      canFallbackToStream: false,
      isOfflineCached: false,
    };
  }

  // 4. Stream-first when referer/403/browser-observed/session indicates direct fails
  if (shouldPreferStreamInitially(resource, snapshot)) {
    return {
      initialMode: 'stream',
      activeSrc: streamSrc,
      streamSrc,
      hlsSrc: null,
      isHls: false,
      canFallbackToStream: false,
      isOfflineCached: false,
    };
  }

  // 5. Direct-first with fast-fail fallback to streamSrc
  return {
    initialMode: 'direct',
    activeSrc: resource.url,
    streamSrc,
    hlsSrc: null,
    isHls: false,
    canFallbackToStream: true,
    isOfflineCached: false,
  };
}
