import type http from 'node:http';
import * as cheerio from 'cheerio';
import { MAX_REDIRECT_HOPS } from '../config/limits.ts';
import { resolveSafeHttpUrl } from './html-extractor.ts';

export interface ClientRedirectMatch {
  targetUrl: string;
  reason: string;
}

export interface RedirectDecision {
  follow: boolean;
  reason: 'meta-refresh' | 'js-stub' | 'has-media' | 'no-nav' | 'no-body';
  delaySec: number | null;
  target: string | null;
}

const MEDIA_ELEMENT_RE =
  /<(video|audio|source|track|iframe|embed|object|picture)\b|og:video|twitter:player:stream|__NEXT_DATA__|__VX_BOOTSTRAP_VIDEO__|\.m3u8|\.mpd/i;

const LOCATION_NAV_RE =
  /\blocation\s*(?:\.\s*href\s*)?=(?!=)|location\s*\.\s*(?:replace|assign)\s*\(|location\s*\[\s*['"]href['"]\s*\]\s*=/;

const META_REFRESH_RE =
  /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*(\d+)\s*[;,]?\s*(?:url\s*=\s*)?([^"'>]*)/i;

function stripHash(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function extractFirstLocationTarget(html: string): string | null {
  const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .join('\n');
  const haystack = inlineScripts || html;

  const patterns = [
    /(?:window|self|top|document)?\.?location\s*\.\s*(?:replace|assign)\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
    /(?:window|self|top|document)?\.?location\s*(?:\.\s*href\s*)?=\s*['"]([^'"]+)['"]/i,
    /(?:window|self|top|document)?\.?location\s*\[\s*['"]href['"]\s*\]\s*=\s*['"]([^'"]+)['"]/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(haystack);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractHeaderRefreshParts(refreshHeader: string | null): {
  delay: number | null;
  target: string | null;
} {
  if (!refreshHeader) return { delay: null, target: null };
  const delayMatch = /\d+/.exec(refreshHeader);
  const delay = delayMatch ? Number(delayMatch[0]) : null;
  const urlMatch = /url\s*=\s*['"]?([^'";\s]+)['"]?/i.exec(refreshHeader);
  return {
    delay: delay !== null && Number.isFinite(delay) ? delay : null,
    target: urlMatch?.[1]?.trim() || null,
  };
}

export function classifyHtmlPage(
  html: string,
  refreshHeader: string | null,
): RedirectDecision {
  if (!html.trim()) {
    return { follow: false, reason: 'no-body', delaySec: null, target: null };
  }

  const hasMedia = MEDIA_ELEMENT_RE.test(html);
  const headerRefresh = extractHeaderRefreshParts(refreshHeader);
  const meta = META_REFRESH_RE.exec(html);
  const delay = headerRefresh.delay ?? (meta ? Number(meta[1]) : null);
  const metaTarget = headerRefresh.target ?? (meta?.[2]?.trim() || null);

  if (
    metaTarget &&
    (delay === null || delay <= Math.max(MAX_REDIRECT_HOPS, 10)) &&
    !hasMedia
  ) {
    return {
      follow: true,
      reason: 'meta-refresh',
      delaySec: delay,
      target: metaTarget,
    };
  }

  if (hasMedia) {
    return { follow: false, reason: 'has-media', delaySec: delay, target: null };
  }

  const text = stripTags(html).replace(/\s+/g, ' ').trim();
  if (text.length < 400 && LOCATION_NAV_RE.test(html)) {
    const jsTarget = extractFirstLocationTarget(html);
    if (jsTarget) {
      return {
        follow: true,
        reason: 'js-stub',
        delaySec: delay,
        target: jsTarget,
      };
    }
  }

  return { follow: false, reason: 'no-nav', delaySec: delay, target: null };
}

export function detectClientSideRedirect(params: {
  html: string;
  baseUrl: string;
  headers?: http.IncomingHttpHeaders;
}): ClientRedirectMatch | null {
  const currentHashless = stripHash(params.baseUrl);
  const rawRefresh = params.headers?.refresh;
  const refreshHeader = Array.isArray(rawRefresh)
    ? rawRefresh[0] ?? null
    : rawRefresh ?? null;

  const decision = classifyHtmlPage(params.html, refreshHeader);
  if (!decision.follow || !decision.target) {
    return null;
  }

  let effectiveBase = params.baseUrl;
  try {
    const $ = cheerio.load(params.html);
    const baseHref = $('base[href]').first().attr('href');
    if (baseHref) {
      const resolvedBase = resolveSafeHttpUrl(baseHref, params.baseUrl);
      if (resolvedBase.ok) {
        effectiveBase = resolvedBase.url;
      }
    }
  } catch {
    effectiveBase = params.baseUrl;
  }

  const resolved = resolveSafeHttpUrl(decision.target, effectiveBase);
  if (!resolved.ok || stripHash(resolved.url) === currentHashless) {
    return null;
  }

  return {
    targetUrl: resolved.url,
    reason:
      decision.reason === 'meta-refresh'
        ? refreshHeader
          ? 'Pengalihan melalui header HTTP Refresh.'
          : 'Pengalihan melalui tag meta refresh HTML.'
        : 'Pengalihan melalui skrip lokasi halaman.',
  };
}
