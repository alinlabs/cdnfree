import type http from 'node:http';
import type { Request, Response } from 'express';
import { InspectionPolicyError } from '../../types/server.ts';
import { rewriteSetCookieForProxy } from './cookie-jar.ts';
import type { RewriteHtmlStats } from './rewrite.ts';
import type { ProxyHttpMethod } from './safe-proxy-fetch.ts';
import { decodeProxyUrl, normalizeProxyTarget } from './urlcodec.ts';

export const MAX_PROXY_REQUEST_BODY_BYTES = 128 * 1024;

const ALLOWED_PROXY_METHODS = new Set<ProxyHttpMethod>([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
]);

export function parseProxyHttpMethod(raw: string): ProxyHttpMethod | null {
  const upper = raw.toUpperCase() as ProxyHttpMethod;
  return ALLOWED_PROXY_METHODS.has(upper) ? upper : null;
}

export async function readBoundedProxyBody(
  req: Request,
  maxBytes = MAX_PROXY_REQUEST_BODY_BYTES,
): Promise<Buffer> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) {
      throw new InspectionPolicyError(
        'RESPONSE_TOO_LARGE',
        'Ukuran payload permintaan melebihi batas maksimum 128 KB.',
        413,
      );
    }
    return req.body;
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        settled = true;
        cleanup();
        reject(
          new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran payload permintaan melebihi batas maksimum 128 KB.',
            413,
          ),
        );
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function unwrapInnerReferer(rawReferer: string | undefined, targetUrl: string): string | undefined {
  let targetOrigin: string;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return undefined;
  }
  if (!rawReferer) return `${targetOrigin}/`;
  try {
    const parsed = new URL(rawReferer);
    if (parsed.pathname.startsWith('/api/proxy')) {
      const inner = parsed.searchParams.get('u');
      if (inner) {
        return normalizeProxyTarget(decodeProxyUrl(inner));
      }
    }
    return `${targetOrigin}/`;
  } catch {
    return `${targetOrigin}/`;
  }
}

export function buildForwardedProxyHeaders(
  req: Request,
  targetUrl: string,
  method: ProxyHttpMethod,
): Record<string, string> {
  const out: Record<string, string> = {};
  const contentType = req.get('content-type');
  if (contentType && method !== 'GET' && method !== 'HEAD') {
    out['Content-Type'] = contentType;
  }

  let targetOrigin: string | undefined;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    targetOrigin = undefined;
  }

  if (targetOrigin && method !== 'GET' && method !== 'HEAD') {
    out.Origin = targetOrigin;
  }

  const referer = unwrapInnerReferer(req.get('referer'), targetUrl);
  if (referer) {
    out.Referer = referer;
  }

  const csrfToken = req.get('x-csrf-token');
  if (csrfToken) out['X-CSRF-Token'] = csrfToken;

  const twitterAuthType = req.get('x-twitter-auth-type');
  if (twitterAuthType) out['X-Twitter-Auth-Type'] = twitterAuthType;

  const requestedWith = req.get('x-requested-with');
  if (requestedWith) out['X-Requested-With'] = requestedWith;

  const cookie = req.get('cookie');
  if (cookie) out.Cookie = cookie;

  return out;
}

export function applyProxiedSetCookieHeaders(
  res: Response,
  upstreamHeaders: http.IncomingHttpHeaders,
): void {
  const rawSetCookie = upstreamHeaders['set-cookie'];
  if (!rawSetCookie) return;
  const list = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
  for (const item of list) {
    if (!item || !item.trim()) continue;
    res.append('Set-Cookie', rewriteSetCookieForProxy(item));
  }
}

export interface ProxyDebugPayload {
  upstreamStatus: number;
  upstreamMime: string;
  finalUrl: string;
  rewritten: RewriteHtmlStats;
  warnings: string[];
  durationMs: number;
}

export function buildProxyDebugPayload(params: {
  upstreamStatus: number;
  upstreamMime: string;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  html?: string;
  rewritten: RewriteHtmlStats;
  durationMs: number;
}): ProxyDebugPayload {
  const warnings: string[] = [];
  const cfMitigated = params.headers['cf-mitigated'];
  const cfRay = params.headers['cf-ray'];
  const lowerHtml = (params.html ?? '').toLowerCase();

  if (
    cfMitigated ||
    lowerHtml.includes('just a moment') ||
    lowerHtml.includes('cf-browser-verification') ||
    lowerHtml.includes('/cdn-cgi/challenge-platform')
  ) {
    warnings.push(
      'Respons mengandung tantangan anti-bot / Cloudflare challenge sehingga konten asli mungkin tertahan.',
    );
  } else if (cfRay && params.upstreamStatus === 403) {
    warnings.push('Server di balik Cloudflare mengembalikan status 403 Forbidden.');
  }

  if (params.upstreamStatus >= 400) {
    warnings.push(`Situs tujuan merespons dengan status HTTP ${params.upstreamStatus}.`);
  }

  if (params.html !== undefined && params.html.trim().length < 240) {
    warnings.push('Ukuran HTML upstream sangat kecil dan mungkin berupa halaman redirect atau shell kosong.');
  }

  return {
    upstreamStatus: params.upstreamStatus,
    upstreamMime: params.upstreamMime || 'unknown',
    finalUrl: params.finalUrl,
    rewritten: params.rewritten,
    warnings,
    durationMs: params.durationMs,
  };
}
