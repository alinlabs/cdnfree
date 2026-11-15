const MAX_SESSIONS = 200;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_COOKIES_PER_SESSION = 150;

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  expiresAt: number | null;
}

interface SessionJar {
  cookies: StoredCookie[];
  updatedAt: number;
}

export class SessionCookieJarStore {
  private readonly jars = new Map<string, SessionJar>();

  private prune(now: number): void {
    for (const [sid, jar] of this.jars.entries()) {
      if (now - jar.updatedAt > SESSION_TTL_MS) {
        this.jars.delete(sid);
      }
    }
    if (this.jars.size >= MAX_SESSIONS) {
      const oldestKey = this.jars.keys().next().value;
      if (oldestKey) this.jars.delete(oldestKey);
    }
  }

  private ensureJar(sid: string): SessionJar {
    const now = Date.now();
    this.prune(now);
    const existing = this.jars.get(sid);
    if (existing) {
      existing.updatedAt = now;
      return existing;
    }
    const created: SessionJar = { cookies: [], updatedAt: now };
    this.jars.set(sid, created);
    return created;
  }

  storeFromHeaders(
    sid: string | undefined,
    requestUrl: string,
    setCookieHeader: string | string[] | undefined,
  ): void {
    if (!sid || !setCookieHeader) return;
    const rawList = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader];
    if (rawList.length === 0) return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(requestUrl);
    } catch {
      return;
    }

    const reqHost = parsedUrl.hostname.toLowerCase();
    const defaultPath = deriveDefaultCookiePath(parsedUrl.pathname);
    const jar = this.ensureJar(sid);
    const now = Date.now();

    for (const rawLine of rawList) {
      const parsed = parseSetCookieLine(rawLine, reqHost, defaultPath, now);
      if (!parsed) continue;
      jar.cookies = jar.cookies.filter(
        (item) =>
          !(
            item.name === parsed.name &&
            item.domain === parsed.domain &&
            item.path === parsed.path
          ),
      );
      if (parsed.expiresAt !== null && parsed.expiresAt <= now) {
        continue;
      }
      jar.cookies.push(parsed);
    }

    if (jar.cookies.length > MAX_COOKIES_PER_SESSION) {
      jar.cookies = jar.cookies.slice(-MAX_COOKIES_PER_SESSION);
    }
  }

  getCookieHeader(sid: string | undefined, requestUrl: string): string | undefined {
    if (!sid) return undefined;
    const jar = this.jars.get(sid);
    if (!jar) return undefined;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(requestUrl);
    } catch {
      return undefined;
    }

    const now = Date.now();
    jar.updatedAt = now;
    jar.cookies = jar.cookies.filter(
      (item) => item.expiresAt === null || item.expiresAt > now,
    );

    const reqHost = parsedUrl.hostname.toLowerCase();
    const reqPath = parsedUrl.pathname || '/';

    const matching = jar.cookies.filter((item) => {
      const hostMatches = item.hostOnly
        ? reqHost === item.domain
        : reqHost === item.domain || reqHost.endsWith(`.${item.domain}`);
      if (!hostMatches) return false;
      return pathMatchesCookie(reqPath, item.path);
    });

    if (matching.length === 0) return undefined;
    matching.sort((a, b) => b.path.length - a.path.length);
    return matching.map((item) => `${item.name}=${item.value}`).join('; ');
  }
}

function deriveDefaultCookiePath(pathname: string): string {
  if (!pathname || !pathname.startsWith('/')) return '/';
  if (pathname === '/') return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash + 1);
}

function pathMatchesCookie(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith('/')) return true;
  return reqPath[cookiePath.length] === '/';
}

function parseSetCookieLine(
  rawLine: string,
  requestHost: string,
  defaultPath: string,
  now: number,
): StoredCookie | null {
  const parts = rawLine.split(';').map((part) => part.trim());
  const first = parts.shift();
  if (!first) return null;
  const eqIdx = first.indexOf('=');
  if (eqIdx <= 0) return null;
  const name = first.slice(0, eqIdx).trim();
  const value = first.slice(eqIdx + 1).trim();
  if (!name) return null;

  let domain = requestHost;
  let hostOnly = true;
  let path = defaultPath;
  let expiresAt: number | null = null;

  for (const attr of parts) {
    const attrEq = attr.indexOf('=');
    const key = (attrEq === -1 ? attr : attr.slice(0, attrEq))
      .trim()
      .toLowerCase();
    const val = attrEq === -1 ? '' : attr.slice(attrEq + 1).trim();

    if (key === 'domain' && val) {
      const cleanDomain = val.replace(/^\.+/, '').toLowerCase();
      if (
        cleanDomain &&
        (requestHost === cleanDomain || requestHost.endsWith(`.${cleanDomain}`))
      ) {
        domain = cleanDomain;
        hostOnly = false;
      } else {
        return null;
      }
    } else if (key === 'path' && val.startsWith('/')) {
      path = val;
    } else if (key === 'max-age' && /^-?\d+$/.test(val)) {
      const seconds = Number.parseInt(val, 10);
      expiresAt = seconds <= 0 ? 0 : now + seconds * 1000;
    } else if (key === 'expires' && val && expiresAt === null) {
      const ts = Date.parse(val);
      if (!Number.isNaN(ts)) {
        expiresAt = ts;
      }
    }
  }

  return { name, value, domain, hostOnly, path, expiresAt };
}

export function rewriteSetCookieForProxy(rawHeader: string): string {
  const parts = rawHeader.split(';').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return rawHeader;
  const kept: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    const lower = part.toLowerCase();
    if (lower.startsWith('domain=') || lower === 'secure') {
      continue;
    }
    if (lower === 'samesite=none') {
      kept.push('SameSite=Lax');
      continue;
    }
    if (lower.startsWith('path=')) {
      kept.push('Path=/api/proxy');
      continue;
    }
    kept.push(part);
  }
  return kept.join('; ');
}
