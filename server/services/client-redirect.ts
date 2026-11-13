import type http from 'node:http';
import * as cheerio from 'cheerio';
import { resolveSafeHttpUrl } from './html-extractor.ts';

export interface ClientRedirectMatch {
  targetUrl: string;
  reason: string;
}

function stripHash(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function extractRefreshHeaderUrl(
  headers: http.IncomingHttpHeaders | undefined,
  baseUrl: string,
): string | null {
  if (!headers) return null;
  const rawRefresh = headers.refresh;
  const value = Array.isArray(rawRefresh) ? rawRefresh[0] : rawRefresh;
  if (!value) return null;

  const urlMatch = /url\s*=\s*['"]?([^'";\s]+)['"]?/i.exec(value);
  if (!urlMatch) return null;

  const resolved = resolveSafeHttpUrl(urlMatch[1], baseUrl);
  return resolved.ok ? resolved.url : null;
}

function extractJsRedirectStubUrl(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): string | null {
  // Only treat inline location redirects as an automatic forwarder when the HTML
  // has no external scripts (so real SPAs are never misclassified) and minimal visible body text.
  if ($('script[src]').length > 0) {
    return null;
  }

  const bodyClone = $('body').clone();
  bodyClone.find('script, style, noscript').remove();
  const visibleText = bodyClone.text().replace(/\s+/g, ' ').trim();
  if (visibleText.length >= 400) {
    return null;
  }

  const inlineScripts = $('script:not([src])')
    .map((_, el) => $(el).html() ?? '')
    .get()
    .join('\n');

  if (!inlineScripts.trim()) {
    return null;
  }

  const patterns = [
    /(?:window|self|top|document)?\.?location\.(?:replace|assign)\(\s*['"]([^'"]+)['"]\s*\)/i,
    /(?:window|self|top|document)?\.?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(inlineScripts);
    if (!match?.[1]) continue;
    const resolved = resolveSafeHttpUrl(match[1], baseUrl);
    if (resolved.ok) {
      return resolved.url;
    }
  }

  return null;
}

export function detectClientSideRedirect(params: {
  html: string;
  baseUrl: string;
  headers?: http.IncomingHttpHeaders;
}): ClientRedirectMatch | null {
  const currentHashless = stripHash(params.baseUrl);

  const headerTarget = extractRefreshHeaderUrl(params.headers, params.baseUrl);
  if (headerTarget && stripHash(headerTarget) !== currentHashless) {
    return {
      targetUrl: headerTarget,
      reason: 'Pengalihan melalui header HTTP Refresh.',
    };
  }

  const $ = cheerio.load(params.html);

  let effectiveBase = params.baseUrl;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    const resolvedBase = resolveSafeHttpUrl(baseHref, params.baseUrl);
    if (resolvedBase.ok) {
      effectiveBase = resolvedBase.url;
    }
  }

  const refreshContent = $('meta[http-equiv="refresh" i]').first().attr('content');
  if (refreshContent) {
    const trimmed = refreshContent.trim();
    const delayMatch = /^(\d+)/.exec(trimmed);
    const delaySeconds = delayMatch ? Number(delayMatch[1]) : undefined;
    const urlMatch = /url\s*=\s*['"]?([^'";\s]+)['"]?/i.exec(trimmed);
    if (
      urlMatch?.[1] &&
      (delaySeconds === undefined || delaySeconds <= 10)
    ) {
      const resolvedMeta = resolveSafeHttpUrl(urlMatch[1], effectiveBase);
      if (resolvedMeta.ok && stripHash(resolvedMeta.url) !== currentHashless) {
        return {
          targetUrl: resolvedMeta.url,
          reason: 'Pengalihan melalui tag meta refresh HTML.',
        };
      }
    }
  }

  const jsTarget = extractJsRedirectStubUrl($, effectiveBase);
  if (jsTarget && stripHash(jsTarget) !== currentHashless) {
    return {
      targetUrl: jsTarget,
      reason: 'Pengalihan melalui skrip lokasi halaman.',
    };
  }

  return null;
}
