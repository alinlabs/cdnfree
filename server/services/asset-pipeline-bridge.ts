import crypto from 'node:crypto';
import type { ResourceSource } from '../../src/utils/classify-resource.ts';
import { HEADER_LADDER, MAX_PROBE_DEPTH } from '../config/limits.ts';
import type {
  AssetKind,
  DnsLookupFn,
  ExtractionTelemetry,
  ResourceRecord,
} from '../types/server.ts';
import { classifyAsset, isGenericMime } from './asset-classify.ts';
import {
  extract,
  MAX_ASSET_BUDGET,
  type ExtractedAsset,
} from './asset-extract.ts';
import { probeAssets, type ProbeFetchFn } from './asset-probe.ts';
import { fetchHtmlBodyWithProfile } from './fetch-head-bytes.ts';
import type { FilterEngine } from './filter-engine.ts';

function toResourceKind(assetKind: AssetKind): ResourceRecord['kind'] {
  switch (assetKind) {
    case 'image':
    case 'vector':
      return 'image';
    case 'video':
    case 'hls':
    case 'dash':
      return 'video';
    case 'audio':
      return 'audio';
    case 'font':
      return 'font';
    case 'stylesheet':
      return 'stylesheet';
    case 'pdf':
      return 'document';
    default:
      return 'other';
  }
}

function toLegacyHint(kind: ResourceRecord['kind']): AssetKind {
  switch (kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'font':
      return 'font';
    case 'stylesheet':
      return 'stylesheet';
    case 'document':
      return 'pdf';
    default:
      return 'other';
  }
}

function toResourceSource(tag: string, attr: string): ResourceSource {
  if (tag === 'img' || tag === 'input') return 'html-img';
  if (tag === 'video') return 'html-video';
  if (tag === 'audio') return 'html-audio';
  if (tag === 'script') return 'html-script';
  if (tag === 'source' || tag === 'track') return 'html-source';
  if (tag === 'style' || attr === 'style') return 'css-reference';
  return 'html-link';
}

function canonicalizeUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    return u.href;
  } catch {
    return rawUrl.trim();
  }
}

function isHlsCandidate(url: string, mime?: string): boolean {
  const m = (mime ?? '').toLowerCase();
  return /\.m3u8(?:\?|$)/i.test(url) || m.includes('mpegurl');
}

function isDashCandidate(url: string, mime?: string): boolean {
  const m = (mime ?? '').toLowerCase();
  return /\.mpd(?:\?|$)/i.test(url) || m.includes('dash+xml');
}

export function buildEmptyKindCounts(): Record<AssetKind, number> {
  return {
    image: 0,
    vector: 0,
    video: 0,
    audio: 0,
    font: 0,
    stylesheet: 0,
    pdf: 0,
    json: 0,
    hls: 0,
    dash: 0,
    wrapper: 0,
    embed: 0,
    other: 0,
  };
}

export function buildStreamPath(inspectionId: string, assetId: string): string {
  return `/api/assets/stream/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
}

export function buildHlsPath(inspectionId: string, assetId: string): string {
  return `/api/hls/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
}

function buildResourceFromExtracted(params: {
  extAsset: ExtractedAsset;
  pageHost: string;
  referer: string;
  depth: number;
  filterEngine: FilterEngine;
  enableFilterMatching: boolean;
  allowlistedHosts: string[];
}): ResourceRecord {
  const mappedKind = toResourceKind(params.extAsset.kind);
  const filterResult = params.enableFilterMatching
    ? params.filterEngine.evaluateUrl(params.extAsset.url, params.pageHost, {
        kind: mappedKind,
        userAllowlistedHosts: params.allowlistedHosts,
      })
    : {
        classification: 'allowed' as const,
        reason: undefined,
      };

  return {
    id:
      params.extAsset.id ||
      crypto.createHash('sha1').update(params.extAsset.url).digest('hex').slice(0, 16),
    url: params.extAsset.url,
    host: params.extAsset.host,
    kind: mappedKind,
    assetKind: params.extAsset.kind,
    mimeType: params.extAsset.mime,
    declaredBytes: params.extAsset.bytes,
    posterUrl: params.extAsset.posterUrl,
    referer: params.referer,
    depth: params.depth,
    source: toResourceSource(params.extAsset.tag, params.extAsset.attr),
    observation: 'discovered',
    classification: filterResult.classification,
    reason: filterResult.reason,
    probe: null,
  };
}

export async function runAssetExtractionAndProbe(params: {
  inspectionId: string;
  html: string;
  finalUrl: string;
  pageHost: string;
  baseResources: ResourceRecord[];
  filterEngine: FilterEngine;
  enableFilterMatching: boolean;
  allowlistedHosts: string[];
  shouldProbe: boolean;
  dnsLookup: DnsLookupFn;
  fetchRange?: ProbeFetchFn;
  signal?: AbortSignal;
}): Promise<{
  resources: ResourceRecord[];
  extraction: ExtractionTelemetry;
}> {
  const extractResult = extract(params.html, new URL(params.finalUrl));
  const mergedByUrl = new Map<string, ResourceRecord>();
  const extractedByUrl = new Map<string, ExtractedAsset>();

  for (const item of extractResult.assets) {
    extractedByUrl.set(item.url, item);
  }

  for (const existing of params.baseResources) {
    const key = canonicalizeUrlKey(existing.url);
    const matchedExtract = extractedByUrl.get(key);
    let assetKind =
      existing.assetKind ??
      classifyAsset({
        url: key,
        hint: matchedExtract?.hint ?? toLegacyHint(existing.kind),
        mime: existing.mimeType,
        typeAttr: matchedExtract?.typeAttr,
      });

    if (isHlsCandidate(key, existing.mimeType ?? matchedExtract?.mime)) {
      assetKind = 'hls';
    } else if (isDashCandidate(key, existing.mimeType ?? matchedExtract?.mime)) {
      assetKind = 'dash';
    }

    mergedByUrl.set(key, {
      ...existing,
      url: key,
      assetKind,
      referer: existing.referer ?? params.finalUrl,
      depth: existing.depth ?? 0,
      posterUrl: existing.posterUrl ?? matchedExtract?.posterUrl,
      mimeType: existing.mimeType ?? matchedExtract?.mime,
    });
  }

  for (const extAsset of extractResult.assets) {
    if (mergedByUrl.has(extAsset.url)) continue;
    if (mergedByUrl.size >= MAX_ASSET_BUDGET) break;

    const record = buildResourceFromExtracted({
      extAsset,
      pageHost: params.pageHost,
      referer: params.finalUrl,
      depth: 0,
      filterEngine: params.filterEngine,
      enableFilterMatching: params.enableFilterMatching,
      allowlistedHosts: params.allowlistedHosts,
    });
    if (isHlsCandidate(record.url, record.mimeType)) record.assetKind = 'hls';
    else if (isDashCandidate(record.url, record.mimeType)) record.assetKind = 'dash';
    mergedByUrl.set(record.url, record);
  }

  const allResources = Array.from(mergedByUrl.values());
  const probeTargets: ExtractedAsset[] = [];
  const targetByUrl = new Map<string, ExtractedAsset>();

  for (const res of allResources) {
    if (res.assetKind === 'wrapper' || res.probe?.reason === 'html-wrapper') {
      continue;
    }

    if (res.observation === 'fetched') {
      res.probe = res.probe ?? {
        status: 'verified',
        reason: 'ok',
        httpStatus: 200,
        mime: res.mimeType,
        bytes: res.declaredBytes,
      };
      continue;
    }

    if (params.shouldProbe) {
      const extMatch = extractedByUrl.get(res.url);
      const probeItem: ExtractedAsset = {
        id: res.id,
        url: res.url,
        host: res.host,
        kind: res.assetKind ?? toLegacyHint(res.kind),
        hint: extMatch?.hint ?? res.assetKind ?? toLegacyHint(res.kind),
        tag: extMatch?.tag ?? 'el',
        attr: extMatch?.attr ?? 'src',
        mime: res.mimeType,
        typeAttr: extMatch?.typeAttr,
        bytes: res.declaredBytes,
        posterUrl: res.posterUrl,
        probe: null,
      };
      probeTargets.push(probeItem);
      targetByUrl.set(res.url, probeItem);
    }
  }

  if (params.shouldProbe && probeTargets.length > 0) {
    await probeAssets(probeTargets, {
      pageUrl: params.finalUrl,
      dnsLookup: params.dnsLookup,
      fetchRange: params.fetchRange,
      signal: params.signal,
    });
  }

  // If any probed asset turned out to be an HTML wrapper (e.g., embedded fake .mp4/player), harvest depth 1
  if (params.shouldProbe && !params.fetchRange && MAX_PROBE_DEPTH > 0) {
    const discoveredWrappers = probeTargets.filter(
      (p) => p.probe?.reason === 'html-wrapper' && p.url !== params.finalUrl,
    ).slice(0, 3);

    const nestedProbeTargets: ExtractedAsset[] = [];
    for (const wrapper of discoveredWrappers) {
      if (params.signal?.aborted) break;
      try {
        const fetched = await fetchHtmlBodyWithProfile(
          wrapper.url,
          params.finalUrl,
          HEADER_LADDER[0],
          { dnsLookup: params.dnsLookup, signal: params.signal, timeoutMs: 5_000 },
        );
        if (fetched.status >= 400 || !fetched.html.trim()) continue;
        const nestedExtract = extract(fetched.html, new URL(fetched.finalUrl));
        for (const nestedAsset of nestedExtract.assets) {
          if (mergedByUrl.has(nestedAsset.url) || mergedByUrl.size >= MAX_ASSET_BUDGET) {
            continue;
          }
          const rec = buildResourceFromExtracted({
            extAsset: nestedAsset,
            pageHost: params.pageHost,
            referer: fetched.finalUrl,
            depth: 1,
            filterEngine: params.filterEngine,
            enableFilterMatching: params.enableFilterMatching,
            allowlistedHosts: params.allowlistedHosts,
          });
          mergedByUrl.set(rec.url, rec);
          allResources.push(rec);
          nestedProbeTargets.push(nestedAsset);
          targetByUrl.set(rec.url, nestedAsset);
        }
      } catch {
        // Best-effort nested wrapper harvest
      }
    }

    if (nestedProbeTargets.length > 0) {
      await probeAssets(nestedProbeTargets, {
        pageUrl: params.finalUrl,
        dnsLookup: params.dnsLookup,
        signal: params.signal,
      });
    }
  }

  const byKind = buildEmptyKindCounts();
  let verifiedCount = 0;
  let unverifiedCount = 0;

  for (const res of allResources) {
    const probed = targetByUrl.get(res.url);
    if (probed?.probe) {
      res.probe = probed.probe;
      if (probed.probe.reason === 'html-wrapper') {
        res.assetKind = 'wrapper';
        res.kind = 'other';
        res.mimeType = probed.mime ?? 'text/html; charset=utf-8';
        res.observation = 'fetched';
      } else if (probed.probe.status === 'verified') {
        res.observation = 'fetched';
        if (typeof probed.bytes === 'number') {
          res.declaredBytes = probed.bytes;
        }
        if (probed.mime && !isGenericMime(probed.mime)) {
          res.mimeType = probed.mime;
        } else if (!res.mimeType && probed.mime) {
          res.mimeType = probed.mime;
        }
        res.assetKind = probed.kind;
        const mappedKind = toResourceKind(probed.kind);
        if (res.kind !== 'script') {
          res.kind = mappedKind;
        }
      }
    }

    let finalAssetKind =
      res.assetKind ??
      classifyAsset({
        url: res.url,
        hint: toLegacyHint(res.kind),
        mime: res.mimeType,
      });
    if (
      finalAssetKind !== 'wrapper' &&
      res.probe?.reason !== 'html-wrapper'
    ) {
      if (isHlsCandidate(res.url, res.mimeType)) finalAssetKind = 'hls';
      else if (isDashCandidate(res.url, res.mimeType)) finalAssetKind = 'dash';
    }
    res.assetKind = finalAssetKind;
    byKind[finalAssetKind] += 1;

    if (finalAssetKind === 'hls' || finalAssetKind === 'dash') {
      const hlsPath = buildHlsPath(params.inspectionId, res.id);
      res.hlsUrl = hlsPath;
      res.streamUrl = hlsPath;
      res.kind = 'video';
    } else {
      res.streamUrl = buildStreamPath(params.inspectionId, res.id);
    }

    if (res.probe?.status === 'verified') {
      verifiedCount += 1;
    } else if (res.probe?.status === 'unverified') {
      unverifiedCount += 1;
    }
  }

  return {
    resources: allResources,
    extraction: {
      candidates: Math.max(extractResult.candidates, allResources.length),
      resolved: Math.max(extractResult.resolved, allResources.length),
      deduped: allResources.length,
      byKind,
      dropped: extractResult.dropped,
      verifiedCount,
      unverifiedCount,
    },
  };
}
