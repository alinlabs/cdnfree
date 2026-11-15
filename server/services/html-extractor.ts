import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import {
  classifyResourceKind,
  detectCdnProvider,
  inferMimeHintFromUrl,
  type ResourceSource,
} from '../../src/utils/classify-resource.ts';
import type {
  LinkRecord,
  ResourceRecord,
} from '../types/server.ts';
import {
  extractCssAssetCandidates,
  extractInlineScriptAssetCandidates,
  extractJsonLdAssetCandidates,
  isDirectAssetHrefUrl,
} from './deep-asset-extractor.ts';
import { FilterEngine } from './filter-engine.ts';
import { getActiveFilterEngine } from './filter-source-manager.ts';
import {
  evaluateLinkSuspicion,
  parseMetaRefresh,
  parseSrcsetUrls,
  resolveSafeHttpUrl,
  type MetaRefreshHint,
} from './html-link-analyzer.ts';

export { resolveSafeHttpUrl, type MetaRefreshHint };

export interface HtmlExtractionOutput {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  effectiveBaseUrl: string;
  metaRefreshHint?: MetaRefreshHint;
  resources: ResourceRecord[];
  links: LinkRecord[];
  manifestUrls?: string[];
  frameUrls?: string[];
  unsafeSchemeCount: number;
  unsafeSchemesSeen: string[];
  cdnHosts: Array<{
    host: string;
    provider: string | null;
    resourceCount: number;
  }>;
}

export interface ExtractHtmlOptions {
  includeStaticLinks?: boolean;
  includeResources?: boolean;
  enableFilterMatching?: boolean;
  warnSuspiciousLinks?: boolean;
  filterEngine?: FilterEngine;
  userAllowlistedHosts?: string[];
}

export const MAX_EXTRACTED_RESOURCES = 1500;
const MAX_EXTRACTED_LINKS = 500;

const LAZY_IMAGE_ATTRS = [
  'src',
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-lazy',
  'data-full-src',
  'data-hi-res-src',
  'data-zoom-image',
  'data-url',
  'data-image',
] as const;

const LAZY_SRCSET_ATTRS = ['srcset', 'data-srcset', 'imagesrcset'] as const;

const META_MEDIA_SELECTORS: Array<{ selector: string; asHint: string }> = [
  { selector: 'meta[property="og:image"]', asHint: 'image' },
  { selector: 'meta[property="og:image:url"]', asHint: 'image' },
  { selector: 'meta[property="og:image:secure_url"]', asHint: 'image' },
  { selector: 'meta[name="twitter:image"]', asHint: 'image' },
  { selector: 'meta[name="twitter:image:src"]', asHint: 'image' },
  { selector: 'meta[property="twitter:image"]', asHint: 'image' },
  { selector: 'meta[name="msapplication-TileImage"]', asHint: 'image' },
  { selector: 'meta[name="thumbnail"]', asHint: 'image' },
  { selector: 'meta[property="og:video"]', asHint: 'video' },
  { selector: 'meta[property="og:video:url"]', asHint: 'video' },
  { selector: 'meta[property="og:video:secure_url"]', asHint: 'video' },
  { selector: 'meta[property="og:audio"]', asHint: 'audio' },
  { selector: 'meta[property="og:audio:url"]', asHint: 'audio' },
  { selector: 'meta[property="og:audio:secure_url"]', asHint: 'audio' },
];

function stableId(prefix: string, value: string): string {
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

export function buildCdnHostSummaries(
  resources: ResourceRecord[],
): HtmlExtractionOutput['cdnHosts'] {
  const hostCounts = new Map<string, number>();
  for (const res of resources) {
    hostCounts.set(res.host, (hostCounts.get(res.host) ?? 0) + 1);
  }

  return Array.from(hostCounts.entries())
    .map(([host, resourceCount]) => ({
      host,
      provider: detectCdnProvider(host),
      resourceCount,
    }))
    .sort((a, b) => b.resourceCount - a.resourceCount);
}

export function createDiscoveredResource(params: {
  url: string;
  pageHost: string;
  source: ResourceSource;
  filterEngine: FilterEngine;
  enableFilterMatching: boolean;
  userAllowlistedHosts: string[];
  rel?: string;
  asHint?: string;
  mimeHint?: string;
  posterUrl?: string;
  observation?: ResourceRecord['observation'];
  declaredBytes?: number;
}): ResourceRecord {
  const parsed = new URL(params.url);
  const kind = classifyResourceKind(params.url, {
    source: params.source,
    rel: params.rel,
    asHint: params.asHint,
    mimeHint: params.mimeHint,
  });
  const mimeType = params.mimeHint || inferMimeHintFromUrl(params.url);
  const filterResult = params.enableFilterMatching
    ? params.filterEngine.evaluateUrl(params.url, params.pageHost, {
        kind,
        userAllowlistedHosts: params.userAllowlistedHosts,
      })
    : {
        matched: false,
        classification: 'allowed' as const,
        decision: 'no_match' as const,
        reason: undefined,
      };

  return {
    id: stableId('res', `${params.source}:${params.url}`),
    url: params.url,
    host: parsed.hostname.toLowerCase(),
    kind,
    mimeType,
    declaredBytes: params.declaredBytes,
    posterUrl: kind === 'video' ? params.posterUrl : undefined,
    source: params.source,
    observation: params.observation ?? 'discovered',
    classification: filterResult.classification,
    reason: filterResult.reason,
  };
}

export function extractStaticHtmlIntelligence(
  html: string,
  documentUrl: string,
  options: ExtractHtmlOptions = {},
): HtmlExtractionOutput {
  const $ = cheerio.load(html);
  const filterEngine = options.filterEngine ?? getActiveFilterEngine();
  const includeResources = options.includeResources ?? true;
  const includeStaticLinks = options.includeStaticLinks ?? true;
  const enableFilterMatching = options.enableFilterMatching ?? true;
  const warnSuspiciousLinks = options.warnSuspiciousLinks ?? true;
  const userAllowlist = options.userAllowlistedHosts ?? [];

  const unsafeSchemes = new Set<string>();
  let unsafeSchemeCount = 0;

  const trackUnsafe = (scheme?: string) => {
    if (!scheme) return;
    unsafeSchemeCount += 1;
    unsafeSchemes.add(scheme);
  };

  let effectiveBaseUrl = documentUrl;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    const resolvedBase = resolveSafeHttpUrl(baseHref, documentUrl);
    if (resolvedBase.ok) {
      effectiveBaseUrl = resolvedBase.url;
    } else {
      trackUnsafe(resolvedBase.unsafeScheme);
    }
  }

  const pageHost = new URL(documentUrl).hostname.toLowerCase();

  const rawTitle =
    $('title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    undefined;
  const title = rawTitle ? rawTitle.replace(/\s+/g, ' ').slice(0, 300) : undefined;

  const rawDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    undefined;
  const description = rawDescription
    ? rawDescription.replace(/\s+/g, ' ').slice(0, 500)
    : undefined;

  let canonicalUrl: string | undefined;
  const canonicalAttr = $('link[rel="canonical"]').first().attr('href');
  if (canonicalAttr) {
    const resolvedCanonical = resolveSafeHttpUrl(canonicalAttr, effectiveBaseUrl);
    if (resolvedCanonical.ok) {
      canonicalUrl = resolvedCanonical.url;
    } else {
      trackUnsafe(resolvedCanonical.unsafeScheme);
    }
  }

  let metaRefreshHint: MetaRefreshHint | undefined;
  const refreshContent = $('meta[http-equiv="refresh" i]').first().attr('content');
  if (refreshContent) {
    metaRefreshHint = parseMetaRefresh(refreshContent, effectiveBaseUrl);
    if (metaRefreshHint.unsafeTargetRejected) {
      trackUnsafe('meta-refresh');
    }
  }

  const resourceMap = new Map<string, ResourceRecord>();
  const manifestUrlSet = new Set<string>();
  const frameUrlSet = new Set<string>();

  const registerResource = (
    rawCandidate: string | undefined,
    source: ResourceSource,
    hints?: {
      rel?: string;
      asHint?: string;
      mimeHint?: string;
      posterUrl?: string;
      stripHash?: boolean;
    },
  ) => {
    if (!includeResources || resourceMap.size >= MAX_EXTRACTED_RESOURCES) return;
    const resolved = resolveSafeHttpUrl(rawCandidate, effectiveBaseUrl);
    if (!resolved.ok) {
      trackUnsafe(resolved.unsafeScheme);
      return;
    }

    let targetUrl = resolved.url;
    if (hints?.stripHash) {
      try {
        const parsed = new URL(targetUrl);
        parsed.hash = '';
        targetUrl = parsed.toString();
      } catch {
        // Keep original URL
      }
    }

    const existing = resourceMap.get(targetUrl);
    if (existing) {
      if (!existing.posterUrl && hints?.posterUrl) {
        existing.posterUrl = hints.posterUrl;
      }
      if (!existing.mimeType && hints?.mimeHint) {
        existing.mimeType = hints.mimeHint;
      }
      return;
    }

    resourceMap.set(
      targetUrl,
      createDiscoveredResource({
        url: targetUrl,
        pageHost,
        source,
        filterEngine,
        enableFilterMatching,
        userAllowlistedHosts: userAllowlist,
        rel: hints?.rel,
        asHint: hints?.asHint,
        mimeHint: hints?.mimeHint,
        posterUrl: hints?.posterUrl,
      }),
    );
  };

  if (includeResources) {
    $('img').each((_, el) => {
      for (const attr of LAZY_IMAGE_ATTRS) {
        registerResource($(el).attr(attr), 'html-img');
      }
      for (const attr of LAZY_SRCSET_ATTRS) {
        for (const candidate of parseSrcsetUrls($(el).attr(attr))) {
          registerResource(candidate, 'html-img');
        }
      }
    });

    $('picture source').each((_, el) => {
      const mimeHint = $(el).attr('type');
      registerResource($(el).attr('src'), 'html-source', { asHint: 'image', mimeHint });
      registerResource($(el).attr('data-src'), 'html-source', { asHint: 'image', mimeHint });
      for (const attr of LAZY_SRCSET_ATTRS) {
        for (const candidate of parseSrcsetUrls($(el).attr(attr))) {
          registerResource(candidate, 'html-source', { asHint: 'image', mimeHint });
        }
      }
    });

    $('input[type="image"][src]').each((_, el) => {
      registerResource($(el).attr('src'), 'html-img', { asHint: 'image' });
    });

    $('video').each((_, el) => {
      const posterAttr = $(el).attr('poster') || $(el).attr('data-poster');
      const resolvedPoster = posterAttr
        ? resolveSafeHttpUrl(posterAttr, effectiveBaseUrl)
        : null;
      const posterUrl = resolvedPoster?.ok ? resolvedPoster.url : undefined;
      registerResource($(el).attr('src'), 'html-video', { posterUrl });
      registerResource($(el).attr('data-src'), 'html-video', { posterUrl });
      if (posterAttr) {
        registerResource(posterAttr, 'html-img');
      }
    });

    $('video source').each((_, el) => {
      const parentVideo = $(el).parent('video');
      const parentPosterAttr = parentVideo.attr('poster') || parentVideo.attr('data-poster');
      const resolvedPoster = parentPosterAttr
        ? resolveSafeHttpUrl(parentPosterAttr, effectiveBaseUrl)
        : null;
      const posterUrl = resolvedPoster?.ok ? resolvedPoster.url : undefined;
      const mimeHint = $(el).attr('type') || undefined;
      registerResource($(el).attr('src'), 'html-source', {
        asHint: 'video',
        mimeHint,
        posterUrl,
      });
      registerResource($(el).attr('data-src'), 'html-source', {
        asHint: 'video',
        mimeHint,
        posterUrl,
      });
      for (const candidate of parseSrcsetUrls($(el).attr('srcset'))) {
        registerResource(candidate, 'html-source', { asHint: 'video', mimeHint, posterUrl });
      }
    });

    $('audio').each((_, el) => {
      registerResource($(el).attr('src'), 'html-audio');
      registerResource($(el).attr('data-src'), 'html-audio');
    });

    $('audio source').each((_, el) => {
      const mimeHint = $(el).attr('type') || undefined;
      registerResource($(el).attr('src'), 'html-source', { asHint: 'audio', mimeHint });
      registerResource($(el).attr('data-src'), 'html-source', { asHint: 'audio', mimeHint });
    });

    $('track[src]').each((_, el) => {
      registerResource($(el).attr('src'), 'html-source', { asHint: 'document' });
    });

    $('script[src]').each((_, el) => {
      registerResource($(el).attr('src'), 'html-script', {
        mimeHint: $(el).attr('type') || 'application/javascript',
      });
    });

    $('link[href], link[imagesrcset]').each((_, el) => {
      const rel = ($(el).attr('rel') ?? '').toLowerCase();
      if (
        rel.includes('stylesheet') ||
        rel.includes('icon') ||
        rel.includes('preload') ||
        rel.includes('prefetch') ||
        rel.includes('modulepreload') ||
        rel.includes('manifest') ||
        rel.includes('image_src')
      ) {
        const asHint = $(el).attr('as') || (rel.includes('image_src') ? 'image' : undefined);
        const mimeHint = $(el).attr('type');
        const href = $(el).attr('href');
        registerResource(href, 'html-link', { rel, asHint, mimeHint });
        if (rel.includes('manifest') && href) {
          const resolvedManifest = resolveSafeHttpUrl(href, effectiveBaseUrl);
          if (resolvedManifest.ok) {
            manifestUrlSet.add(resolvedManifest.url);
          }
        }
        for (const candidate of parseSrcsetUrls($(el).attr('imagesrcset'))) {
          registerResource(candidate, 'html-link', { rel, asHint: asHint || 'image', mimeHint });
        }
      }
    });

    for (const metaRule of META_MEDIA_SELECTORS) {
      $(metaRule.selector).each((_, el) => {
        const content = $(el).attr('content');
        if (content) {
          registerResource(content, 'html-link', { asHint: metaRule.asHint });
        }
      });
    }

    $('iframe[src], frame[src], embed[src]').each((_, el) => {
      const rawSrc = $(el).attr('src');
      const isFrame = el.tagName === 'iframe' || el.tagName === 'frame';
      registerResource(rawSrc, 'html-source', {
        asHint: isFrame ? 'document' : undefined,
        mimeHint: $(el).attr('type'),
      });
      if (isFrame && rawSrc) {
        const resolvedFrame = resolveSafeHttpUrl(rawSrc, effectiveBaseUrl);
        if (resolvedFrame.ok) {
          frameUrlSet.add(resolvedFrame.url);
        }
      }
    });

    $('object[data]').each((_, el) => {
      registerResource($(el).attr('data'), 'html-source', {
        mimeHint: $(el).attr('type'),
      });
    });

    $('[background]').each((_, el) => {
      registerResource($(el).attr('background'), 'html-img', { asHint: 'image' });
    });

    $('[data-bg], [data-background], [data-background-image]').each((_, el) => {
      for (const attr of ['data-bg', 'data-background', 'data-background-image']) {
        const val = $(el).attr(attr);
        if (!val) continue;
        if (val.includes('url(')) {
          for (const item of extractCssAssetCandidates(val)) {
            registerResource(item.rawUrl, 'css-reference', { asHint: 'image' });
          }
        } else {
          registerResource(val, 'html-img', { asHint: 'image' });
        }
      }
    });

    $('svg image, svg use').each((_, el) => {
      const ref = $(el).attr('href') || $(el).attr('xlink:href');
      if (ref && !ref.trim().startsWith('#')) {
        registerResource(ref, 'html-img', { stripHash: true });
      }
    });

    $('[style]').each((_, el) => {
      const styleText = $(el).attr('style');
      if (styleText && (styleText.includes('url(') || styleText.includes('@import'))) {
        for (const item of extractCssAssetCandidates(styleText)) {
          registerResource(item.rawUrl, item.source, { asHint: item.asHint, rel: item.rel });
        }
      }
    });

    $('style').each((_, el) => {
      const cssText = $(el).html();
      if (cssText && (cssText.includes('url(') || cssText.includes('@import'))) {
        for (const item of extractCssAssetCandidates(cssText)) {
          registerResource(item.rawUrl, item.source, { asHint: item.asHint, rel: item.rel });
        }
      }
    });

    $('script:not([src])').each((_, el) => {
      const type = ($(el).attr('type') ?? '').toLowerCase();
      const rawText = $(el).html() ?? '';
      if (!rawText.trim()) return;

      if (type.includes('ld+json')) {
        for (const item of extractJsonLdAssetCandidates(rawText)) {
          registerResource(item.rawUrl, item.source, { asHint: item.asHint });
        }
        return;
      }

      if (!type || type.includes('javascript') || type.includes('json')) {
        for (const item of extractInlineScriptAssetCandidates(rawText)) {
          registerResource(item.rawUrl, item.source, { asHint: item.asHint });
        }
      }
    });
  }

  const linkMap = new Map<string, LinkRecord>();

  if (includeStaticLinks || includeResources) {
    $('a[href]').each((_, el) => {
      if (!includeStaticLinks && resourceMap.size >= MAX_EXTRACTED_RESOURCES) return;
      if (includeStaticLinks && linkMap.size >= MAX_EXTRACTED_LINKS && resourceMap.size >= MAX_EXTRACTED_RESOURCES) {
        return;
      }

      const rawHref = $(el).attr('href');
      const resolved = resolveSafeHttpUrl(rawHref, effectiveBaseUrl);
      if (!resolved.ok) {
        if (includeStaticLinks) {
          trackUnsafe(resolved.unsafeScheme);
        }
        return;
      }

      const parsedHref = new URL(resolved.url);
      const rel = $(el).attr('rel')?.trim();

      if (includeResources && isDirectAssetHrefUrl(parsedHref)) {
        registerResource(resolved.url, 'html-link', {
          rel,
          mimeHint: inferMimeHintFromUrl(resolved.url),
        });
      }

      if (!includeStaticLinks || linkMap.size >= MAX_EXTRACTED_LINKS || linkMap.has(resolved.url)) {
        return;
      }

      const visibleText = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 180);
      const filterResult = enableFilterMatching
        ? filterEngine.evaluateUrl(resolved.url, pageHost, {
            kind: 'document',
            userAllowlistedHosts: userAllowlist,
          })
        : {
            matched: false,
            classification: 'allowed' as const,
            decision: 'no_match' as const,
            reason: undefined,
          };

      const heuristicEvidence = warnSuspiciousLinks
        ? evaluateLinkSuspicion(parsedHref, visibleText, pageHost)
        : [];

      let classification: LinkRecord['classification'] = 'ordinary';
      const evidence: string[] = [];

      if (filterResult.decision === 'matched_block_rule') {
        classification = 'ad-or-tracker';
        if (filterResult.reason) evidence.push(filterResult.reason);
      } else if (filterResult.decision === 'allowed_by_user' && filterResult.reason) {
        evidence.push(filterResult.reason);
      }

      if (
        heuristicEvidence.length > 0 &&
        filterResult.decision !== 'allowed_by_user'
      ) {
        classification = 'suspicious';
        evidence.push(...heuristicEvidence);
      }

      linkMap.set(resolved.url, {
        id: stableId('lnk', resolved.url),
        href: resolved.url,
        host: parsedHref.hostname.toLowerCase(),
        text: visibleText || undefined,
        rel: rel || undefined,
        classification,
        evidence: evidence.length > 0 ? evidence : undefined,
      });
    });
  }

  const resources = Array.from(resourceMap.values());

  return {
    title,
    description,
    canonicalUrl,
    effectiveBaseUrl,
    metaRefreshHint,
    resources,
    links: Array.from(linkMap.values()),
    manifestUrls: Array.from(manifestUrlSet),
    frameUrls: Array.from(frameUrlSet),
    unsafeSchemeCount,
    unsafeSchemesSeen: Array.from(unsafeSchemes),
    cdnHosts: buildCdnHostSummaries(resources),
  };
}
