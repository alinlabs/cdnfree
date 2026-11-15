export interface HlsVariantItem {
  url: string;
  bandwidth: number;
  resolution?: string;
}

export interface ParsedHlsManifest {
  isMaster: boolean;
  isLive: boolean;
  variants: HlsVariantItem[];
  segments: string[];
  initSegments: string[];
  keyUris: string[];
}

export interface HlsLocalRewriteResult {
  rewrittenManifest: string;
  assetsToCache: Array<{ upstreamUrl: string; localPath: string }>;
}

function resolveHlsUri(rawUri: string, baseUrl: string): string | null {
  const trimmed = rawUri.trim();
  if (!trimmed) return null;
  try {
    const resolved = new URL(
      trimmed,
      typeof window !== 'undefined' ? new URL(baseUrl, window.location.origin).href : baseUrl,
    );
    return resolved.href;
  } catch {
    return null;
  }
}

export function isVodHlsPlaylist(manifestText: string): boolean {
  const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
  const hasMasterStream = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  if (hasMasterStream) return true;
  const hasEndList = lines.some((l) => l === '#EXT-X-ENDLIST');
  if (!hasEndList) return false;
  return true;
}

export function parseHlsManifest(
  manifestText: string,
  baseUrl: string,
): ParsedHlsManifest {
  const lines = manifestText.split(/\r?\n/);
  const variants: HlsVariantItem[] = [];
  const segments: string[] = [];
  const initSegments: string[] = [];
  const keyUris: string[] = [];

  let pendingVariant: { bandwidth: number; resolution?: string } | null = null;
  let hasEndList = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed === '#EXT-X-ENDLIST') {
      hasEndList = true;
      continue;
    }

    if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
      const bwMatch = /\bBANDWIDTH=(\d+)/i.exec(trimmed);
      const resMatch = /\bRESOLUTION=(\d+x\d+)/i.exec(trimmed);
      pendingVariant = {
        bandwidth: bwMatch ? Number(bwMatch[1]) : 0,
        resolution: resMatch?.[1],
      };
      continue;
    }

    if (trimmed.startsWith('#EXT-X-MAP')) {
      const uriMatch = /\bURI=(["'])([^"']+)\1/i.exec(trimmed);
      if (uriMatch?.[2]) {
        const resolved = resolveHlsUri(uriMatch[2], baseUrl);
        if (resolved && !initSegments.includes(resolved)) {
          initSegments.push(resolved);
        }
      }
      continue;
    }

    if (trimmed.startsWith('#EXT-X-KEY')) {
      const uriMatch = /\bURI=(["'])([^"']+)\1/i.exec(trimmed);
      if (uriMatch?.[2]) {
        const resolved = resolveHlsUri(uriMatch[2], baseUrl);
        if (resolved && !keyUris.includes(resolved)) {
          keyUris.push(resolved);
        }
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    const resolved = resolveHlsUri(trimmed, baseUrl);
    if (!resolved) {
      pendingVariant = null;
      continue;
    }

    if (pendingVariant !== null) {
      variants.push({
        url: resolved,
        bandwidth: pendingVariant.bandwidth,
        resolution: pendingVariant.resolution,
      });
      pendingVariant = null;
    } else {
      segments.push(resolved);
    }
  }

  const isMaster = variants.length > 0;
  return {
    isMaster,
    isLive: !isMaster && !hasEndList,
    variants: [...variants].sort((a, b) => b.bandwidth - a.bandwidth),
    segments,
    initSegments,
    keyUris,
  };
}

export function selectOptimalHlsVariant(
  variants: HlsVariantItem[],
  preferredMaxBandwidth = 4_000_000,
): HlsVariantItem | null {
  if (variants.length === 0) return null;
  const sorted = [...variants].sort((a, b) => b.bandwidth - a.bandwidth);
  const underCap = sorted.find((v) => v.bandwidth > 0 && v.bandwidth <= preferredMaxBandwidth);
  if (underCap) return underCap;
  return sorted[Math.floor(sorted.length / 2)] ?? sorted[0] ?? null;
}

export function rewriteHlsPlaylistToLocal(
  manifestText: string,
  baseUrl: string,
  cacheKey: string,
): HlsLocalRewriteResult {
  const lines = manifestText.split(/\r?\n/);
  const out: string[] = [];
  const assetsToCache: Array<{ upstreamUrl: string; localPath: string }> = [];
  const urlToLocal = new Map<string, string>();

  let segIdx = 0;
  let initIdx = 0;
  let keyIdx = 0;

  const prefix = `/smartcache/v1/hls/${encodeURIComponent(cacheKey)}`;

  const assignLocalPath = (
    upstreamUrl: string,
    kind: 'seg' | 'init' | 'key',
  ): string => {
    const existing = urlToLocal.get(upstreamUrl);
    if (existing) return existing;
    let localPath: string;
    if (kind === 'init') {
      localPath = `${prefix}/init-${initIdx}`;
      initIdx += 1;
    } else if (kind === 'key') {
      localPath = `${prefix}/key-${keyIdx}`;
      keyIdx += 1;
    } else {
      localPath = `${prefix}/seg-${segIdx}`;
      segIdx += 1;
    }
    urlToLocal.set(upstreamUrl, localPath);
    assetsToCache.push({ upstreamUrl, localPath });
    return localPath;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-MAP')) {
      const rewritten = line.replace(
        /\bURI=(["'])([^"']+)\1/i,
        (full, quote: string, rawUri: string) => {
          const resolved = resolveHlsUri(rawUri, baseUrl);
          if (!resolved) return full;
          return `URI=${quote}${assignLocalPath(resolved, 'init')}${quote}`;
        },
      );
      out.push(rewritten);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-KEY')) {
      const rewritten = line.replace(
        /\bURI=(["'])([^"']+)\1/i,
        (full, quote: string, rawUri: string) => {
          const resolved = resolveHlsUri(rawUri, baseUrl);
          if (!resolved) return full;
          return `URI=${quote}${assignLocalPath(resolved, 'key')}${quote}`;
        },
      );
      out.push(rewritten);
      continue;
    }

    if (trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }

    const resolved = resolveHlsUri(trimmed, baseUrl);
    if (!resolved) {
      out.push(line);
      continue;
    }
    out.push(assignLocalPath(resolved, 'seg'));
  }

  return {
    rewrittenManifest: out.join('\n'),
    assetsToCache,
  };
}
