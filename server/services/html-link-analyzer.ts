import { isThirdPartyHost } from './filter-engine.ts';

export interface MetaRefreshHint {
  delaySeconds?: number;
  targetUrl?: string;
  rawContent: string;
  unsafeTargetRejected?: boolean;
}

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

export function resolveSafeHttpUrl(
  rawCandidate: string | undefined,
  baseUrl: string,
): { ok: true; url: string } | { ok: false; unsafeScheme?: string } {
  if (!rawCandidate) return { ok: false };
  const trimmed = rawCandidate.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return { ok: false };
  }

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

export function parseSrcsetUrls(srcsetValue: string | undefined): string[] {
  if (!srcsetValue) return [];
  const results: string[] = [];
  for (const part of srcsetValue.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const firstSpace = trimmed.search(/\s/);
    const urlToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    if (urlToken) {
      results.push(urlToken);
    }
  }
  return results;
}

export function parseMetaRefresh(
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

export function evaluateLinkSuspicion(
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
