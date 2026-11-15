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

export function resolveVideoSourcePlan({
  resource,
  inspectionId,
  smartCacheKey,
  isCachedOffline = false,
  cachedMediaUrl = null,
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
      canFallbackToStream: false,
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

  // 4. Direct playback ("Putar langsung") for all progressive HTTP(S) videos;
  // streamSrc is retained only for SmartCache hydration and CORS thumbnail capture.
  return {
    initialMode: 'direct',
    activeSrc: resource.url,
    streamSrc,
    hlsSrc: null,
    isHls: false,
    canFallbackToStream: false,
    isOfflineCached: false,
  };
}
