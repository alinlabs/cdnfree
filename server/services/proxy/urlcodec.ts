export function encodeProxyUrl(absUrl: string): string {
  return Buffer.from(absUrl, 'utf8').toString('base64url');
}

export function decodeProxyUrl(encoded: string): string {
  const trimmed = encoded.trim();
  if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error('bad_encoding');
  }
  const decoded = Buffer.from(trimmed, 'base64url').toString('utf8');
  if (!decoded) {
    throw new Error('empty');
  }
  return decoded;
}

export function normalizeProxyTarget(raw: string, base?: string): string {
  let candidate = (raw ?? '').trim();
  if (!candidate) {
    throw new Error('empty');
  }

  if (candidate.startsWith('//')) {
    const baseProtocol =
      base && base.startsWith('http://') ? 'http:' : 'https:';
    candidate = `${baseProtocol}${candidate}`;
  } else if (base && !/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = new URL(candidate, base).href;
  }

  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('bad_scheme');
  }
  if (parsed.username || parsed.password) {
    throw new Error('bad_credentials');
  }

  return parsed.href;
}

export function sanitizeSessionId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !/^[a-zA-Z0-9_-]{8,80}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildAssetProxyUrl(
  origin: string,
  absUrl: string,
  sessionId?: string,
): string {
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  const qs = `u=${encodeProxyUrl(absUrl)}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;
  return `${cleanOrigin}/api/asset?${qs}`;
}

function getRegistrableSiteKey(hostname: string): string {
  const clean = hostname.trim().toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (tld.length === 2 && /^(co|com|net|org|edu|gov|ac|my|biz|web|or|go|sch|mil)$/i.test(sld)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function isExternalSiteUrl(candidateUrl: string, rootUrl: string): boolean {
  try {
    const dest = new URL(candidateUrl);
    const root = new URL(rootUrl);
    if (dest.protocol !== 'http:' && dest.protocol !== 'https:') return false;
    if (root.protocol !== 'http:' && root.protocol !== 'https:') return false;
    const destHost = dest.hostname.toLowerCase();
    const rootHost = root.hostname.toLowerCase();
    if (destHost === rootHost) return false;
    return getRegistrableSiteKey(destHost) !== getRegistrableSiteKey(rootHost);
  } catch {
    return false;
  }
}

export interface FrameProxyUrlOptions {
  extBypass?: boolean;
  rootUrl?: string;
}

export function buildFrameProxyUrl(
  origin: string,
  absUrl: string,
  sessionId?: string,
  options?: FrameProxyUrlOptions,
): string {
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  let qs = `u=${encodeProxyUrl(absUrl)}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;
  if (typeof options?.extBypass === 'boolean') {
    qs += `&extbypass=${options.extBypass ? '1' : '0'}`;
  }
  if (options?.rootUrl) {
    qs += `&root=${encodeProxyUrl(options.rootUrl)}`;
  }
  return `${cleanOrigin}/api/proxy?${qs}`;
}
