import type http from 'node:http';
import {
  isAllowedHtmlContentType,
  MAX_HTML_BYTES,
  parseMimeType,
  PROXY_LIMITS,
} from '../security/request-limits.ts';
import { MAX_FRAMES, MAX_PLAYLISTS } from '../config/limits.ts';
import type { DnsLookupFn, ResourceRecord } from '../types/server.ts';
import { deduplicateResources } from '../../src/utils/asset-explorer.ts';
import {
  classifyResourceKind,
  type ResourceSource,
} from '../../src/utils/classify-resource.ts';
import { isGenericMime } from './asset-classify.ts';
import { extractMpdAssetUrls } from './asset-extract.ts';
import {
  extractCssAssetCandidates,
  extractInlineScriptAssetCandidates,
  extractM3u8AssetCandidates,
  extractManifestAssetCandidates,
} from './deep-asset-extractor.ts';
import type { FilterEngine } from './filter-engine.ts';
import {
  buildCdnHostSummaries,
  createDiscoveredResource,
  extractStaticHtmlIntelligence,
  MAX_EXTRACTED_RESOURCES,
  type HtmlExtractionOutput,
} from './html-extractor.ts';
import { resolveSafeHttpUrl } from './html-link-analyzer.ts';
import { safeProxyFetch } from './proxy/safe-proxy-fetch.ts';

export interface SecondaryFetchResponse {
  finalUrl: string;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: Buffer;
}

export type SecondaryFetchFn = (
  url: string,
  options: {
    method: 'GET' | 'HEAD';
    maxBytes: number;
    timeoutMs: number;
    dnsLookup: DnsLookupFn;
    signal?: AbortSignal;
  },
) => Promise<SecondaryFetchResponse>;

export interface ScanSecondaryAssetsParams {
  extraction: HtmlExtractionOutput;
  finalUrl: string;
  pageHost: string;
  filterEngine: FilterEngine;
  enableFilterMatching: boolean;
  allowlistedHosts: string[];
  dnsLookup: DnsLookupFn;
  fetchSecondary?: SecondaryFetchFn;
  signal?: AbortSignal;
  budgetMs?: number;
}

const DEFAULT_SCAN_BUDGET_MS = 6_500;
const SECONDARY_CONCURRENCY = 6;
const MAX_STYLESHEETS = 15;
const MAX_IMPORT_STYLESHEETS = 6;
const MAX_ENTRY_SCRIPTS = 4;
const MAX_MANIFESTS = 3;
const MAX_HEAD_PROBES = 12;

function getHeaderString(
  headers: http.IncomingHttpHeaders,
  name: string,
): string | undefined {
  const val = headers[name.toLowerCase()];
  return Array.isArray(val) ? val[0] : val;
}

function parseContentLength(headers: http.IncomingHttpHeaders): number | undefined {
  const raw = getHeaderString(headers, 'content-length');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isBlockedForSecondaryFetch(resource: ResourceRecord): boolean {
  return (
    resource.observation === 'blocked' ||
    resource.classification === 'ad-or-tracker' ||
    resource.classification === 'known-malicious'
  );
}

async function runBoundedPool<T>(
  items: T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0 || signal.aborted) return;
  let cursor = 0;
  const count = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (cursor < items.length && !signal.aborted) {
        const current = items[cursor];
        cursor += 1;
        try {
          await worker(current);
        } catch {
          // Best-effort secondary crawl; individual asset fetch failures never fail the inspection
        }
      }
    }),
  );
}

export async function scanSecondaryAssets(
  params: ScanSecondaryAssetsParams,
): Promise<{
  resources: ResourceRecord[];
  cdnHosts: HtmlExtractionOutput['cdnHosts'];
}> {
  const fetcher: SecondaryFetchFn =
    params.fetchSecondary ??
    (async (url, opts) =>
      safeProxyFetch(url, {
        method: opts.method,
        maxBytes: opts.maxBytes,
        timeoutMs: opts.timeoutMs,
        dnsLookup: opts.dnsLookup,
        signal: opts.signal,
      }));

  const budgetController = new AbortController();
  const abortBudget = () => budgetController.abort();
  if (params.signal?.aborted) {
    return {
      resources: params.extraction.resources,
      cdnHosts: params.extraction.cdnHosts,
    };
  }
  params.signal?.addEventListener('abort', abortBudget, { once: true });
  const budgetTimer = setTimeout(abortBudget, params.budgetMs ?? DEFAULT_SCAN_BUDGET_MS);

  const byUrl = new Map<string, ResourceRecord>();
  for (const res of params.extraction.resources) {
    byUrl.set(res.url, { ...res });
  }

  const registerCandidate = (
    rawUrl: string,
    baseUrl: string,
    source: ResourceSource,
    hints?: {
      rel?: string;
      asHint?: string;
      mimeHint?: string;
      posterUrl?: string;
      observation?: ResourceRecord['observation'];
    },
  ) => {
    if (byUrl.size >= MAX_EXTRACTED_RESOURCES) return;
    const resolved = resolveSafeHttpUrl(rawUrl, baseUrl);
    if (!resolved.ok) return;

    const existing = byUrl.get(resolved.url);
    if (existing) {
      if (!existing.mimeType && hints?.mimeHint) {
        existing.mimeType = hints.mimeHint;
      }
      if (!existing.posterUrl && hints?.posterUrl) {
        existing.posterUrl = hints.posterUrl;
      }
      return;
    }

    const created = createDiscoveredResource({
      url: resolved.url,
      pageHost: params.pageHost,
      source,
      filterEngine: params.filterEngine,
      enableFilterMatching: params.enableFilterMatching,
      userAllowlistedHosts: params.allowlistedHosts,
      rel: hints?.rel,
      asHint: hints?.asHint,
      mimeHint: hints?.mimeHint,
      posterUrl: hints?.posterUrl,
      observation: hints?.observation ?? 'discovered',
    });
    created.referer = baseUrl || params.finalUrl;
    if (
      /\.m3u8(?:\?|$)/i.test(resolved.url) ||
      hints?.mimeHint?.toLowerCase().includes('mpegurl')
    ) {
      created.assetKind = 'hls';
    } else if (
      /\.mpd(?:\?|$)/i.test(resolved.url) ||
      hints?.mimeHint?.toLowerCase().includes('dash+xml')
    ) {
      created.assetKind = 'dash';
    }
    byUrl.set(resolved.url, created);
  };

  try {
    const stylesheetTargets = Array.from(byUrl.values())
      .filter(
        (r) =>
          r.kind === 'stylesheet' &&
          !isBlockedForSecondaryFetch(r) &&
          r.observation !== 'fetched',
      )
      .slice(0, MAX_STYLESHEETS);

    const importCssUrls: Array<{ url: string; baseUrl: string }> = [];
    const seenCssUrls = new Set(stylesheetTargets.map((r) => r.url));

    const fetchAndScanCss = async (targetUrl: string, collectImports: boolean) => {
      const res = await fetcher(targetUrl, {
        method: 'GET',
        maxBytes: PROXY_LIMITS.text,
        timeoutMs: 3000,
        dnsLookup: params.dnsLookup,
        signal: budgetController.signal,
      });
      if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return;

      const mime = parseMimeType(getHeaderString(res.headers, 'content-type'));
      if (mime && !mime.includes('css') && !mime.startsWith('text/')) {
        return;
      }

      const existing = byUrl.get(targetUrl) ?? byUrl.get(res.finalUrl);
      if (existing) {
        existing.observation = 'fetched';
        if (mime) existing.mimeType = mime;
        existing.declaredBytes =
          parseContentLength(res.headers) ?? res.body.byteLength;
      }

      const cssText = res.body.toString('utf8');
      for (const candidate of extractCssAssetCandidates(cssText)) {
        if (candidate.rel === 'stylesheet' && collectImports) {
          const resolvedImp = resolveSafeHttpUrl(candidate.rawUrl, res.finalUrl);
          if (
            resolvedImp.ok &&
            !seenCssUrls.has(resolvedImp.url) &&
            importCssUrls.length < MAX_IMPORT_STYLESHEETS
          ) {
            seenCssUrls.add(resolvedImp.url);
            importCssUrls.push({ url: resolvedImp.url, baseUrl: res.finalUrl });
          }
        }
        registerCandidate(candidate.rawUrl, res.finalUrl, candidate.source, {
          asHint: candidate.asHint,
          rel: candidate.rel,
        });
      }
    };

    const manifestTargets = (params.extraction.manifestUrls ?? []).slice(0, MAX_MANIFESTS);
    const frameTargets = (params.extraction.frameUrls ?? [])
      .filter((u) => {
        if (u === params.finalUrl) return false;
        const existing = byUrl.get(u);
        return !existing || !isBlockedForSecondaryFetch(existing);
      })
      .slice(0, MAX_FRAMES);

    const playlistTargets = Array.from(byUrl.values())
      .filter(
        (r) =>
          !isBlockedForSecondaryFetch(r) &&
          (/\.m3u8(?:\?|$)/i.test(r.url) ||
            r.mimeType?.toLowerCase().includes('mpegurl')),
      )
      .map((r) => r.url)
      .slice(0, MAX_PLAYLISTS);

    const mpdTargets = Array.from(byUrl.values())
      .filter(
        (r) =>
          !isBlockedForSecondaryFetch(r) &&
          (/\.mpd(?:\?|$)/i.test(r.url) ||
            r.mimeType?.toLowerCase().includes('dash+xml')),
      )
      .map((r) => r.url)
      .slice(0, MAX_PLAYLISTS);

    const scriptTargets = Array.from(byUrl.values())
      .filter(
        (r) =>
          r.kind === 'script' &&
          !isBlockedForSecondaryFetch(r) &&
          r.observation !== 'fetched' &&
          !/google-analytics|googletagmanager|gtag|fbevents|hotjar|clarity|doubleclick/i.test(r.url),
      )
      .sort((a, b) => {
        const aSame = a.host === params.pageHost ? 1 : 0;
        const bSame = b.host === params.pageHost ? 1 : 0;
        return bSame - aSame;
      })
      .map((r) => r.url)
      .slice(0, MAX_ENTRY_SCRIPTS);

    type SecondaryTask =
      | { type: 'css'; url: string }
      | { type: 'manifest'; url: string }
      | { type: 'frame'; url: string }
      | { type: 'm3u8'; url: string }
      | { type: 'mpd'; url: string }
      | { type: 'script'; url: string };

    const pass1Tasks: SecondaryTask[] = [
      ...stylesheetTargets.map((r): SecondaryTask => ({ type: 'css', url: r.url })),
      ...manifestTargets.map((url): SecondaryTask => ({ type: 'manifest', url })),
      ...frameTargets.map((url): SecondaryTask => ({ type: 'frame', url })),
      ...playlistTargets.map((url): SecondaryTask => ({ type: 'm3u8', url })),
      ...mpdTargets.map((url): SecondaryTask => ({ type: 'mpd', url })),
      ...scriptTargets.map((url): SecondaryTask => ({ type: 'script', url })),
    ];

    await runBoundedPool(pass1Tasks, SECONDARY_CONCURRENCY, budgetController.signal, async (task) => {
      if (task.type === 'css') {
        await fetchAndScanCss(task.url, true);
        return;
      }

      if (task.type === 'manifest') {
        const res = await fetcher(task.url, {
          method: 'GET',
          maxBytes: 256_000,
          timeoutMs: 2500,
          dnsLookup: params.dnsLookup,
          signal: budgetController.signal,
        });
        if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return;
        const existing = byUrl.get(task.url);
        if (existing) {
          existing.observation = 'fetched';
          const mime = parseMimeType(getHeaderString(res.headers, 'content-type'));
          if (mime) existing.mimeType = mime;
          existing.declaredBytes = parseContentLength(res.headers) ?? res.body.byteLength;
        }
        for (const candidate of extractManifestAssetCandidates(res.body.toString('utf8'))) {
          registerCandidate(candidate.rawUrl, res.finalUrl, candidate.source, {
            asHint: candidate.asHint,
            mimeHint: candidate.mimeHint,
          });
        }
        return;
      }

      if (task.type === 'm3u8') {
        const res = await fetcher(task.url, {
          method: 'GET',
          maxBytes: 512_000,
          timeoutMs: 2500,
          dnsLookup: params.dnsLookup,
          signal: budgetController.signal,
        });
        if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return;
        const existing = byUrl.get(task.url);
        if (existing) {
          existing.observation = 'fetched';
          const mime = parseMimeType(getHeaderString(res.headers, 'content-type'));
          if (mime) existing.mimeType = mime;
          existing.declaredBytes = parseContentLength(res.headers) ?? res.body.byteLength;
        }
        for (const candidate of extractM3u8AssetCandidates(res.body.toString('utf8'))) {
          registerCandidate(candidate.rawUrl, res.finalUrl, candidate.source, {
            asHint: candidate.asHint,
            mimeHint: candidate.mimeHint,
          });
        }
        return;
      }

      if (task.type === 'mpd') {
        const res = await fetcher(task.url, {
          method: 'GET',
          maxBytes: 512_000,
          timeoutMs: 2500,
          dnsLookup: params.dnsLookup,
          signal: budgetController.signal,
        });
        if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return;
        const existing = byUrl.get(task.url);
        if (existing) {
          existing.observation = 'fetched';
          const mime = parseMimeType(getHeaderString(res.headers, 'content-type'));
          if (mime) existing.mimeType = mime;
          existing.declaredBytes = parseContentLength(res.headers) ?? res.body.byteLength;
        }
        for (const rawUrl of extractMpdAssetUrls(res.body.toString('utf8'))) {
          registerCandidate(rawUrl, res.finalUrl, 'html-source', {
            asHint: 'video',
          });
        }
        return;
      }

      if (task.type === 'script') {
        const res = await fetcher(task.url, {
          method: 'GET',
          maxBytes: PROXY_LIMITS.text,
          timeoutMs: 2500,
          dnsLookup: params.dnsLookup,
          signal: budgetController.signal,
        });
        if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return;
        const mime = parseMimeType(getHeaderString(res.headers, 'content-type'));
        if (mime && !mime.includes('javascript') && !mime.includes('ecmascript') && !mime.startsWith('text/')) {
          return;
        }
        const existing = byUrl.get(task.url);
        if (existing) {
          existing.observation = 'fetched';
          if (mime) existing.mimeType = mime;
          existing.declaredBytes = parseContentLength(res.headers) ?? res.body.byteLength;
        }
        for (const candidate of extractInlineScriptAssetCandidates(res.body.toString('utf8'))) {
          registerCandidate(candidate.rawUrl, res.finalUrl, candidate.source, {
            asHint: candidate.asHint,
          });
        }
        return;
      }

      // Embedded <iframe> / <frame> document (1 level deep)
      const res = await fetcher(task.url, {
        method: 'GET',
        maxBytes: MAX_HTML_BYTES,
        timeoutMs: 3500,
        dnsLookup: params.dnsLookup,
        signal: budgetController.signal,
      });
      if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return;
      const contentType = getHeaderString(res.headers, 'content-type');
      if (!isAllowedHtmlContentType(contentType)) {
        const mime = parseMimeType(contentType);
        const existing = byUrl.get(task.url);
        if (existing && mime) {
          existing.observation = 'fetched';
          existing.mimeType = mime;
          existing.declaredBytes = parseContentLength(res.headers) ?? res.body.byteLength;
          existing.kind = classifyResourceKind(existing.url, {
            source: existing.source,
            mimeHint: mime,
          });
        }
        return;
      }

      const frameExtraction = extractStaticHtmlIntelligence(
        res.body.toString('utf8'),
        res.finalUrl,
        {
          includeStaticLinks: false,
          includeResources: true,
          enableFilterMatching: params.enableFilterMatching,
          filterEngine: params.filterEngine,
          userAllowlistedHosts: params.allowlistedHosts,
        },
      );
      for (const nestedRes of frameExtraction.resources) {
        if (byUrl.size >= MAX_EXTRACTED_RESOURCES) break;
        if (!byUrl.has(nestedRes.url)) {
          byUrl.set(nestedRes.url, nestedRes);
        }
      }
    });

    // Follow 1 level of @import stylesheets discovered in Pass 1
    if (importCssUrls.length > 0 && !budgetController.signal.aborted) {
      await runBoundedPool(importCssUrls, SECONDARY_CONCURRENCY, budgetController.signal, async (imp) => {
        await fetchAndScanCss(imp.url, false);
      });
    }

    // Pass 2: HEAD metadata enrichment & reclassification for extensionless/incomplete assets
    const headTargets = Array.from(byUrl.values())
      .filter(
        (r) =>
          !isBlockedForSecondaryFetch(r) &&
          r.observation !== 'fetched' &&
          (!r.mimeType || typeof r.declaredBytes !== 'number') &&
          (r.kind === 'other' ||
            r.kind === 'video' ||
            r.kind === 'audio' ||
            r.kind === 'image' ||
            r.kind === 'document'),
      )
      .sort((a, b) => {
        const score = (item: ResourceRecord) =>
          (item.kind === 'other' ? 4 : 2) + (!item.mimeType ? 2 : 0);
        return score(b) - score(a);
      })
      .slice(0, MAX_HEAD_PROBES);

    await runBoundedPool(headTargets, SECONDARY_CONCURRENCY, budgetController.signal, async (resItem) => {
      const headRes = await fetcher(resItem.url, {
        method: 'HEAD',
        maxBytes: 0,
        timeoutMs: 2500,
        dnsLookup: params.dnsLookup,
        signal: budgetController.signal,
      });
      if (headRes.statusCode < 200 || headRes.statusCode >= 400) return;

      const mime = parseMimeType(getHeaderString(headRes.headers, 'content-type'));
      const length = parseContentLength(headRes.headers);
      resItem.observation = 'fetched';
      if (mime && !isGenericMime(mime)) {
        resItem.mimeType = mime;
      }
      if (typeof length === 'number') {
        resItem.declaredBytes = length;
      }

      if (resItem.mimeType) {
        const nextKind = classifyResourceKind(resItem.url, {
          source: resItem.source,
          mimeHint: resItem.mimeType,
        });
        if (nextKind !== resItem.kind) {
          resItem.kind = nextKind;
          if (params.enableFilterMatching) {
            const reEval = params.filterEngine.evaluateUrl(
              resItem.url,
              params.pageHost,
              {
                kind: nextKind,
                userAllowlistedHosts: params.allowlistedHosts,
              },
            );
            resItem.classification = reEval.classification;
            resItem.reason = reEval.reason;
          }
        }
      }
    });
  } finally {
    clearTimeout(budgetTimer);
    params.signal?.removeEventListener('abort', abortBudget);
  }

  const mergedResources = deduplicateResources(Array.from(byUrl.values())).slice(
    0,
    MAX_EXTRACTED_RESOURCES,
  );
  return {
    resources: mergedResources,
    cdnHosts: buildCdnHostSummaries(mergedResources),
  };
}
