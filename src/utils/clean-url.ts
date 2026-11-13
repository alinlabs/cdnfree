import { redactUrlForDisplay } from './redact-url';

export interface CleanUrlOptions {
  redactSensitive?: boolean;
  stripHttp?: boolean;
}

function stripLeadingWww(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith('www.') && hostname.slice(4).includes('.')) {
    return hostname.slice(4);
  }
  return hostname;
}

/**
 * Formats an HTTP/HTTPS URL into a clean display/query form:
 * - Strips `https://` (and `http://` when `stripHttp` is enabled)
 * - Strips leading `www.` subdomain
 * - Strips trailing `/` when there is no path, query, or hash after the domain
 */
export function formatCleanUrl(
  rawUrl: string,
  options: CleanUrlOptions = {},
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const candidate = options.redactSensitive ? redactUrlForDisplay(trimmed) : trimmed;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return candidate;
    }

    const protocolPrefix =
      parsed.protocol === 'https:' || options.stripHttp
        ? ''
        : `${parsed.protocol}//`;

    const cleanHost = stripLeadingWww(parsed.hostname);
    const portSuffix = parsed.port ? `:${parsed.port}` : '';

    const hasPathOrParams =
      parsed.pathname !== '/' || Boolean(parsed.search) || Boolean(parsed.hash);
    const tail = hasPathOrParams
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : '';

    return `${protocolPrefix}${cleanHost}${portSuffix}${tail}`;
  } catch {
    return candidate;
  }
}

export function encodeCleanUrQueryValue(rawUrl: string): string {
  const cleaned = formatCleanUrl(rawUrl);
  return encodeURIComponent(cleaned).replace(/%2F/gi, '/');
}
