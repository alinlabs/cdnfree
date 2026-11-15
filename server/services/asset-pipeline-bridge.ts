import crypto from 'node:crypto';
import type { ResourceSource } from '../../src/utils/classify-resource.ts';
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
import type { FilterEngine } from './filter-engine.ts';

function toResourceKind(assetKind: AssetKind): ResourceRecord['kind'] {
  switch (assetKind) {
    case 'image':
    case 'vector':
      return 'image';
    case 'video':
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
    other: 0,
  };
}

export function buildStreamPath(inspectionId: string, assetId: string): string {
  return `/api/assets/stream/${encodeURIComponent(inspectionId)}/${encodeURIComponent(assetId)}`;
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
    const assetKind =
      existing.assetKind ??
      classifyAsset({
        url: key,
        hint: matchedExtract?.hint ?? toLegacyHint(existing.kind),
        mime: existing.mimeType,
        typeAttr: matchedExtract?.typeAttr,
      });

    mergedByUrl.set(key, {
      ...existing,
      url: key,
      assetKind,
      posterUrl: existing.posterUrl ?? matchedExtract?.posterUrl,
      mimeType: existing.mimeType ?? matchedExtract?.mime,
    });
  }

  for (const extAsset of extractResult.assets) {
    if (mergedByUrl.has(extAsset.url)) continue;
    if (mergedByUrl.size >= MAX_ASSET_BUDGET) break;

    const mappedKind = toResourceKind(extAsset.kind);
    const filterResult = params.enableFilterMatching
      ? params.filterEngine.evaluateUrl(extAsset.url, params.pageHost, {
          kind: mappedKind,
          userAllowlistedHosts: params.allowlistedHosts,
        })
      : {
          classification: 'allowed' as const,
          reason: undefined,
        };

    mergedByUrl.set(extAsset.url, {
      id: extAsset.id || crypto.createHash('sha1').update(extAsset.url).digest('hex').slice(0, 16),
      url: extAsset.url,
      host: extAsset.host,
      kind: mappedKind,
      assetKind: extAsset.kind,
      mimeType: extAsset.mime,
      declaredBytes: extAsset.bytes,
      posterUrl: extAsset.posterUrl,
      source: toResourceSource(extAsset.tag, extAsset.attr),
      observation: 'discovered',
      classification: filterResult.classification,
      reason: filterResult.reason,
      probe: null,
    });
  }

  const allResources = Array.from(mergedByUrl.values());
  const probeTargets: ExtractedAsset[] = [];
  const targetByUrl = new Map<string, ExtractedAsset>();

  for (const res of allResources) {
    if (res.observation === 'fetched') {
      res.probe = {
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

  const byKind = buildEmptyKindCounts();
  let verifiedCount = 0;
  let unverifiedCount = 0;

  for (const res of allResources) {
    const probed = targetByUrl.get(res.url);
    if (probed?.probe) {
      res.probe = probed.probe;
      if (probed.probe.status === 'verified') {
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

    const finalAssetKind =
      res.assetKind ??
      classifyAsset({
        url: res.url,
        hint: toLegacyHint(res.kind),
        mime: res.mimeType,
      });
    res.assetKind = finalAssetKind;
    byKind[finalAssetKind] += 1;

    res.streamUrl = buildStreamPath(params.inspectionId, res.id);

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
