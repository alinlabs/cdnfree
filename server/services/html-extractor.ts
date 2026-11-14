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
import { FilterEngine, isThirdPartyHost } from './filter-engine.ts';
import { getActiveFilterEngine } from './filter-source-manager.ts';

export interface MetaRefreshHint {
  delaySeconds?: number;
  targetUrl?: string;
  rawContent: string;
  unsafeTargetRejected?: boolean;
}

export interface HtmlExtractionOutput {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  effectiveBaseUrl: string;
  metaRefreshHint?: MetaRefreshHint;
  resources: ResourceRecord[];
  links: LinkRecord[];
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

const MAX_EXTRACTED_RESOURCES = 250;
const MAX_EXTRACTED_LINKS = 250;

const URL_SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  's.id',
  'cutt.ly',
  'shorturl.at',
  'rebrand.ly',
  'ow.ly',
  'is.gd',
  'tiny.cc',
  'goo.gl',
]);

const BAIT_TEXT_REGEX =
  /\b(download\s*now|unduh\s*sekarang|free\s*download|play\s*now|putar\s*video|claim\s*prize|verifikasi\s*akun|verify\s*now)\b/i;

const REDIRECT_QUERY_KEYS = new Set([
  'redirect',
  'redirect_uri',
  'redirect_url',
  'url',
  'next',
  'dest',
  'destination',
  'target',
  'goto',
  'return',
  'r',
  'u',
]);

function stableId(prefix: string, value: string): string {
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

export function resolveSafeHttpUrl(
  rawCandidate: string | undefined,
  baseUrl: string,
): { ok: true; url: string } | { ok: false; unsafeScheme?: string } {
  if (!rawCandidate) return { ok: false };
  const trimmed = rawCandidate.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return { ok: false };
  }

  // Detect explicit non-http(s) schemes early (including whitespace-obfuscated javascript:)
  const normalizedPrefix = trimmed.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/.exec(normalizedPrefix);
  if (schemeMatch) {
    const scheme = schemeMatch[1];
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, unsafeScheme: `${scheme}:` };
    }
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return { ok: false, unsafeScheme: resolved.protocol };
    }
    if (resolved.username !== '' || resolved.password !== '') {
      return { ok: false, unsafeScheme: 'credentials' };
    }
    return { ok: true, url: resolved.toString() };
  } catch {
    return { ok: false };
  }
}

function parseSrcsetUrls(srcsetValue: string | undefined): string[] {
  if (!srcsetValue) return [];
  const results: string[] = [];
  for (const part of srcsetValue.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // URL is the first whitespace-delimited token in each srcset candidate
    const firstSpace = trimmed.search(/\s/);
    const urlToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    if (urlToken) {
      results.push(urlToken);
    }
  }
  return results;
}

function parseMetaRefresh(
  rawContent: string,
  baseUrl: string,
): MetaRefreshHint {
  const trimmed = rawContent.trim();
  const delayMatch = /^(\d+)/.exec(trimmed);
  const delaySeconds = delayMatch ? Number(delayMatch[1]) : undefined;
  const urlMatch = /url\s*=\s*['"]?([^'";\s]+)['"]?/i.exec(trimmed);
  if (!urlMatch) {
    return { delaySeconds, rawContent: trimmed };
  }

  const resolved = resolveSafeHttpUrl(urlMatch[1], baseUrl);
  if (resolved.ok) {
    return {
      delaySeconds,
      targetUrl: resolved.url,
      rawContent: trimmed,
    };
  }

  return {
    delaySeconds,
    rawContent: trimmed,
    unsafeTargetRejected: Boolean(resolved.unsafeScheme),
  };
}

function extractDomainLikeHostFromText(text: string): string | null {
  const urlMatch = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i.exec(text);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }
  const bareDomainMatch = /^\s*([a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,})(?:\/|\s|$)/i.exec(text);
  if (bareDomainMatch) {
    return bareDomainMatch[1].toLowerCase();
  }
  return null;
}

function evaluateLinkSuspicion(
  parsedHref: URL,
  visibleText: string,
  pageHost: string,
): string[] {
  const evidence: string[] = [];
  const destHost = parsedHref.hostname.toLowerCase();

  if (URL_SHORTENER_HOSTS.has(destHost)) {
    evidence.push(
      `Menggunakan pemendek tautan (${destHost}); tujuan akhir belum terlihat sebelum dibuka.`,
    );
  }

  const textHost = extractDomainLikeHostFromText(visibleText);
  if (
    textHost &&
    textHost !== destHost &&
    !destHost.endsWith(`.${textHost}`) &&
    !textHost.endsWith(`.${destHost}`)
  ) {
    evidence.push(
      `Teks tautan menampilkan domain (${textHost}) yang berbeda dari tujuan (${destHost}).`,
    );
  }

  const hasRedirectQuery = Array.from(parsedHref.searchParams.keys()).some((key) =>
    REDIRECT_QUERY_KEYS.has(key.toLowerCase()),
  );
  if (
    BAIT_TEXT_REGEX.test(visibleText) &&
    isThirdPartyHost(destHost, pageHost) &&
    hasRedirectQuery
  ) {
    evidence.push(
      'Teks ajakan unduh/putar mengarah ke domain pihak ketiga dengan parameter pengalihan.',
    );
  }

  return evidence;
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

  // Determine effective document base URL safely
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

  const registerResource = (
    rawCandidate: string | undefined,
    source: ResourceSource,
    hints?: { rel?: string; asHint?: string; mimeHint?: string; posterUrl?: string },
  ) => {
    if (!includeResources || resourceMap.size >= MAX_EXTRACTED_RESOURCES) return;
    const resolved = resolveSafeHttpUrl(rawCandidate, effectiveBaseUrl);
    if (!resolved.ok) {
      trackUnsafe(resolved.unsafeScheme);
      return;
    }

    const existing = resourceMap.get(resolved.url);
    if (existing) {
      if (!existing.posterUrl && hints?.posterUrl) {
        existing.posterUrl = hints.posterUrl;
      }
      return;
    }

    const parsed = new URL(resolved.url);
    const kind = classifyResourceKind(resolved.url, {
      source,
      rel: hints?.rel,
      asHint: hints?.asHint,
      mimeHint: hints?.mimeHint,
    });
    const mimeType = hints?.mimeHint || inferMimeHintFromUrl(resolved.url);
    const filterResult = enableFilterMatching
      ? filterEngine.evaluateUrl(resolved.url, pageHost, {
          kind,
          userAllowlistedHosts: userAllowlist,
        })
      : {
          matched: false,
          classification: 'allowed' as const,
          decision: 'no_match' as const,
          reason: undefined,
        };

    resourceMap.set(resolved.url, {
      id: stableId('res', `${source}:${resolved.url}`),
      url: resolved.url,
      host: parsed.hostname.toLowerCase(),
      kind,
      mimeType,
      posterUrl: kind === 'video' ? hints?.posterUrl : undefined,
      source,
      observation: 'discovered',
      classification: filterResult.classification,
      reason: filterResult.reason,
    });
  };

  if (includeResources) {
    $('img').each((_, el) => {
      registerResource($(el).attr('src'), 'html-img');
      for (const candidate of parseSrcsetUrls($(el).attr('srcset'))) {
        registerResource(candidate, 'html-img');
      }
    });

    $('picture source').each((_, el) => {
      const mimeHint = $(el).attr('type');
      for (const candidate of parseSrcsetUrls($(el).attr('srcset'))) {
        registerResource(candidate, 'html-source', { mimeHint });
      }
    });

    $('video').each((_, el) => {
      const posterAttr = $(el).attr('poster');
      const resolvedPoster = posterAttr
        ? resolveSafeHttpUrl(posterAttr, effectiveBaseUrl)
        : null;
      const posterUrl = resolvedPoster?.ok ? resolvedPoster.url : undefined;
      registerResource($(el).attr('src'), 'html-video', { posterUrl });
      if (posterAttr) {
        registerResource(posterAttr, 'html-img');
      }
    });

    $('video source').each((_, el) => {
      const parentPosterAttr = $(el).parent('video').attr('poster');
      const resolvedPoster = parentPosterAttr
        ? resolveSafeHttpUrl(parentPosterAttr, effectiveBaseUrl)
        : null;
      const posterUrl = resolvedPoster?.ok ? resolvedPoster.url : undefined;
      registerResource($(el).attr('src'), 'html-source', {
        asHint: 'video',
        mimeHint: $(el).attr('type') || undefined,
        posterUrl,
      });
    });

    $('audio').each((_, el) => {
      registerResource($(el).attr('src'), 'html-audio');
    });

    $('audio source').each((_, el) => {
      registerResource($(el).attr('src'), 'html-source', {
        asHint: 'audio',
        mimeHint: $(el).attr('type') || undefined,
      });
    });

    $('script[src]').each((_, el) => {
      registerResource($(el).attr('src'), 'html-script', {
        mimeHint: $(el).attr('type') || 'application/javascript',
      });
    });

    $('link[href]').each((_, el) => {
      const rel = ($(el).attr('rel') ?? '').toLowerCase();
      if (
        rel.includes('stylesheet') ||
        rel.includes('icon') ||
        rel.includes('preload') ||
        rel.includes('prefetch') ||
        rel.includes('modulepreload')
      ) {
        registerResource($(el).attr('href'), 'html-link', {
          rel,
          asHint: $(el).attr('as'),
          mimeHint: $(el).attr('type'),
        });
      }
    });

    $('iframe[src], embed[src]').each((_, el) => {
      registerResource($(el).attr('src'), 'html-source', {
        asHint: el.tagName === 'iframe' ? 'document' : undefined,
        mimeHint: $(el).attr('type'),
      });
    });

    $('object[data]').each((_, el) => {
      registerResource($(el).attr('data'), 'html-source', {
        mimeHint: $(el).attr('type'),
      });
    });
  }

  const linkMap = new Map<string, LinkRecord>();

  if (includeStaticLinks) {
    $('a[href]').each((_, el) => {
      if (linkMap.size >= MAX_EXTRACTED_LINKS) return;
      const rawHref = $(el).attr('href');
      const resolved = resolveSafeHttpUrl(rawHref, effectiveBaseUrl);
      if (!resolved.ok) {
        trackUnsafe(resolved.unsafeScheme);
        return;
      }

      if (linkMap.has(resolved.url)) return;

      const parsedHref = new URL(resolved.url);
      const visibleText = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 180);
      const rel = $(el).attr('rel')?.trim();

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

      const isDirectAssetLink = /\.(?:pdf|svg|png|jpe?g|webp|avif|gif|ico|mp4|webm|mp3|wav|m4a|ogg|woff2?|ttf|otf)$/i.test(
        parsedHref.pathname,
      );
      if (includeResources && isDirectAssetLink) {
        registerResource(resolved.url, 'html-link', {
          rel,
          mimeHint: inferMimeHintFromUrl(resolved.url),
        });
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
  const hostCounts = new Map<string, number>();
  for (const res of resources) {
    hostCounts.set(res.host, (hostCounts.get(res.host) ?? 0) + 1);
  }

  const cdnHosts = Array.from(hostCounts.entries())
    .map(([host, resourceCount]) => ({
      host,
      provider: detectCdnProvider(host),
      resourceCount,
    }))
    .sort((a, b) => b.resourceCount - a.resourceCount);

  return {
    title,
    description,
    canonicalUrl,
    effectiveBaseUrl,
    metaRefreshHint,
    resources,
    links: Array.from(linkMap.values()),
    unsafeSchemeCount,
    unsafeSchemesSeen: Array.from(unsafeSchemes),
    cdnHosts,
  };
}
