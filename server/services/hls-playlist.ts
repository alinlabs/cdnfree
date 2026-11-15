export interface PlaylistContext {
  sid: string;
  assetId: string;
  playlistUrl: string;
  tokenQuery: string;
  tokenOrigin: string;
}

export interface ParsedPlaylist {
  isMaster: boolean;
  variants: Array<{ url: string; bandwidth: number }>;
  segments: string[];
  initSegments: string[];
}

export function buildHlsProxyPath(sid: string, assetId: string, childUrl: string): string {
  const encodedUrl = Buffer.from(childUrl, 'utf8').toString('base64url');
  return `/api/hls/${encodeURIComponent(sid)}/${encodeURIComponent(assetId)}?u=${encodedUrl}`;
}

export function decodeHlsChildUrl(encoded: string): string | null {
  if (!encoded || encoded.length > 4096) return null;
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8').trim();
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function resolveChildUrl(rawUri: string, ctx: PlaylistContext): string | null {
  const trimmed = rawUri.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed, ctx.playlistUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.search && u.origin === ctx.tokenOrigin && ctx.tokenQuery) {
      u.search = ctx.tokenQuery;
    }
    return u.href;
  } catch {
    return null;
  }
}

export function rewritePlaylist(body: string, ctx: PlaylistContext): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      const rewrittenLine = line.replace(
        /\bURI=(["'])([^"']+)\1/gi,
        (full, quote: string, rawUri: string) => {
          const resolved = resolveChildUrl(rawUri, ctx);
          if (!resolved) return full;
          return `URI=${quote}${buildHlsProxyPath(ctx.sid, ctx.assetId, resolved)}${quote}`;
        },
      );
      out.push(rewrittenLine);
      continue;
    }

    const resolved = resolveChildUrl(trimmed, ctx);
    if (!resolved) {
      out.push(line);
      continue;
    }
    out.push(buildHlsProxyPath(ctx.sid, ctx.assetId, resolved));
  }

  return out.join('\n');
}

export function listSegments(body: string, ctx: PlaylistContext): ParsedPlaylist {
  const lines = body.split(/\r?\n/);
  const variants: Array<{ url: string; bandwidth: number }> = [];
  const segments: string[] = [];
  const initSegments: string[] = [];
  let pendingBandwidth: number | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
      const bwMatch = /\bBANDWIDTH=(\d+)/i.exec(trimmed);
      pendingBandwidth = bwMatch ? Number(bwMatch[1]) : 0;
      continue;
    }

    if (trimmed.startsWith('#EXT-X-MAP')) {
      const uriMatch = /\bURI=(["'])([^"']+)\1/i.exec(trimmed);
      if (uriMatch?.[2]) {
        const resolved = resolveChildUrl(uriMatch[2], ctx);
        if (resolved) initSegments.push(resolved);
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    const resolved = resolveChildUrl(trimmed, ctx);
    if (!resolved) {
      pendingBandwidth = null;
      continue;
    }

    if (pendingBandwidth !== null) {
      variants.push({ url: resolved, bandwidth: pendingBandwidth });
      pendingBandwidth = null;
    } else {
      segments.push(resolved);
    }
  }

  return {
    isMaster: variants.length > 0,
    variants: [...variants].sort((a, b) => b.bandwidth - a.bandwidth),
    segments,
    initSegments,
  };
}

export function parseExpiry(urlStr: string): number | null {
  try {
    const parsed = new URL(urlStr);
    const candidates = ['exp', 'expires', 'expire', 'e', 'Expires'];
    for (const key of candidates) {
      const raw = parsed.searchParams.get(key);
      if (!raw || !/^\d+$/.test(raw)) continue;
      const val = Number(raw);
      if (!Number.isFinite(val) || val <= 0) continue;
      return val > 1e12 ? Math.floor(val / 1000) : val;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildPlaylistContext(
  sid: string,
  assetId: string,
  playlistUrl: string,
  rootUrl?: string,
): PlaylistContext {
  const root = new URL(rootUrl || playlistUrl);
  return {
    sid,
    assetId,
    playlistUrl,
    tokenQuery: root.search,
    tokenOrigin: root.origin,
  };
}
