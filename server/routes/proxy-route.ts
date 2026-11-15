import { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import {
  MAX_REDIRECT_HOPS,
  PROXY_LIMITS,
  SlidingWindowRateLimiter,
  parseMimeType,
} from '../security/request-limits.ts';
import { detectClientSideRedirect } from '../services/client-redirect.ts';
import {
  InspectionStore,
  defaultInspectionStore,
} from '../services/inspection-store.ts';
import {
  applyMediaPassThroughHeaders,
  fetchAssetWithHeaderProfile,
  getHeaderSingle,
  isJavaScriptMime,
  isM3u8Asset,
  isPdfAsset,
  isSvgAsset,
  mapProxyError,
  renderFriendlyErrorHtml,
  resolveTotalBytesFromHeaders,
  resolveUpstreamBuffer,
  sendRangedOrStreamedAsset,
} from '../services/proxy/asset-route-helpers.ts';
import {
  CapturedAssetStore,
  defaultCapturedAssetStore,
} from '../services/proxy/captured-store.ts';
import { SessionCookieJarStore } from '../services/proxy/cookie-jar.ts';
import {
  applyProxiedSetCookieHeaders,
  buildForwardedProxyHeaders,
  buildProxyDebugPayload,
  parseProxyHttpMethod,
  readBoundedProxyBody,
} from '../services/proxy/proxy-request-helpers.ts';
import {
  rewriteCssUrls,
  rewriteEsModuleSpecifiers,
  rewriteHtmlDocumentWithStats,
  rewriteM3u8Playlist,
} from '../services/proxy/rewrite.ts';
import {
  safeProxyFetch,
  type SafeProxyFetchOptions,
  type SafeProxyFetchResult,
} from '../services/proxy/safe-proxy-fetch.ts';
import {
  guessMimeTypeFromUrl,
  pipeUpstream,
} from '../services/proxy/stream-response.ts';
import { derivePublicOrigin, setFrameable } from '../services/proxy/frame.ts';
import { buildProxyShim } from '../services/proxy/shim.ts';
import { sanitizeSvgXml } from '../services/proxy/svg-sanitizer.ts';
import {
  decodeProxyUrl,
  isExternalSiteUrl,
  normalizeProxyTarget,
  sanitizeSessionId,
} from '../services/proxy/urlcodec.ts';
import { type DnsLookupFn } from '../types/server.ts';

export interface ProxyRouterDependencies {
  store?: InspectionStore;
  capturedStore?: CapturedAssetStore;
  cookieJar?: SessionCookieJarStore;
  proxyRateLimiter?: SlidingWindowRateLimiter;
  assetRateLimiter?: SlidingWindowRateLimiter;
  dnsLookup?: DnsLookupFn;
  fetchProxy?: (
    rawUrl: string,
    options?: SafeProxyFetchOptions,
  ) => Promise<SafeProxyFetchResult>;
}

function resolveFallbackOrigin(req: Request): string {
  try {
    return derivePublicOrigin(req);
  } catch {
    return '';
  }
}

function buildAssetReferer(targetUrl: string, pageUrl?: string): string | undefined {
  if (!pageUrl) return undefined;
  try {
    const page = new URL(pageUrl);
    const target = new URL(targetUrl);
    return page.origin === target.origin ? page.toString() : `${page.origin}/`;
  } catch {
    return undefined;
  }
}

function buildAssetAcceptHeader(targetUrl: string): string {
  const guessed = guessMimeTypeFromUrl(targetUrl);
  if (guessed.startsWith('image/') || guessed === 'application/octet-stream') {
    return 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
  }
  return '*/*';
}

function isMediaUrlExpectation(url: string): boolean {
  const guessed = guessMimeTypeFromUrl(url);
  return (
    guessed.startsWith('image/') ||
    guessed.startsWith('video/') ||
    guessed.startsWith('audio/') ||
    guessed.startsWith('font/')
  );
}

export function createProxyRouter(
  deps: ProxyRouterDependencies = {},
): Router {
  const router = Router();
  const store = deps.store ?? defaultInspectionStore;
  const capturedStore = deps.capturedStore ?? defaultCapturedAssetStore;
  const cookieJar = deps.cookieJar ?? new SessionCookieJarStore();
  const proxyRateLimiter =
    deps.proxyRateLimiter ?? new SlidingWindowRateLimiter(60_000, 120);
  const assetRateLimiter =
    deps.assetRateLimiter ?? new SlidingWindowRateLimiter(60_000, 1200);
  const fetchProxy = deps.fetchProxy ?? safeProxyFetch;

  router.all('/proxy', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const method = parseProxyHttpMethod(req.method);
    if (!method) {
      res.status(405).json({
        success: false,
        code: 'METHOD_NOT_ALLOWED',
        error: 'Metode HTTP tidak didukung pada endpoint proxy.',
      });
      return;
    }

    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!proxyRateLimiter.allow(clientKey)) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Terlalu banyak permintaan ke proxy. Coba lagi sebentar.',
      });
      return;
    }

    const fallbackOrigin = resolveFallbackOrigin(req);
    const sid = sanitizeSessionId(req.query.sid);
    const bypassExternalLinks = req.query.extbypass !== '0';
    const isDebug = req.query.debug === '1';

    let explicitRootUrl: string | undefined;
    if (typeof req.query.root === 'string' && req.query.root.trim()) {
      try {
        explicitRootUrl = normalizeProxyTarget(decodeProxyUrl(req.query.root));
      } catch {
        explicitRootUrl = undefined;
      }
    }

    let target: string;
    try {
      const encoded = String(req.query.u ?? '');
      target = normalizeProxyTarget(decodeProxyUrl(encoded));
    } catch {
      setFrameable(res);
      res.status(400).json({
        success: false,
        code: 'bad_scheme',
        error: 'URL tidak valid atau protokol tidak didukung.',
      });
      return;
    }

    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const body = await readBoundedProxyBody(req);
      const forwardedHeaders = buildForwardedProxyHeaders(req, target, method);

      let upstream = await fetchProxy(target, {
        method,
        body: body.length > 0 ? body : undefined,
        headers: forwardedHeaders,
        cookieJar,
        sid,
        stream: true,
        dnsLookup: deps.dnsLookup,
        signal: controller.signal,
      });

      let bufferedHtmlBody: Buffer | null = null;
      const visitedProxyUrls = new Set<string>([upstream.finalUrl.split('#')[0]]);

      for (let clientHop = 0; clientHop < MAX_REDIRECT_HOPS; clientHop += 1) {
        if (method !== 'GET' && method !== 'HEAD') break;
        const hopContentType = getHeaderSingle(upstream.headers['content-type']);
        const hopMime = parseMimeType(hopContentType);
        if (hopMime !== 'text/html' && hopMime !== 'application/xhtml+xml' && hopMime !== '') {
          break;
        }
        bufferedHtmlBody = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.html);
        const clientRedirect = detectClientSideRedirect({
          html: bufferedHtmlBody.toString('utf8'),
          baseUrl: upstream.finalUrl,
          headers: upstream.headers,
        });
        if (!clientRedirect) break;
        const nextHashless = clientRedirect.targetUrl.split('#')[0];
        if (visitedProxyUrls.has(nextHashless)) break;
        visitedProxyUrls.add(nextHashless);
        bufferedHtmlBody = null;
        upstream = await fetchProxy(clientRedirect.targetUrl, {
          cookieJar,
          sid,
          stream: true,
          dnsLookup: deps.dnsLookup,
          signal: controller.signal,
        });
      }

      const contentTypeHeader = getHeaderSingle(upstream.headers['content-type']);
      const mime = parseMimeType(contentTypeHeader);

      if (mime !== 'text/html' && mime !== 'application/xhtml+xml' && mime !== '') {
        if (isDebug) {
          upstream.cleanup?.();
          res.status(200).json(
            buildProxyDebugPayload({
              upstreamStatus: upstream.statusCode || 200,
              upstreamMime: contentTypeHeader || guessMimeTypeFromUrl(upstream.finalUrl),
              finalUrl: upstream.finalUrl,
              headers: upstream.headers,
              rewritten: { links: 0, assets: 0 },
              durationMs: Date.now() - startedAt,
            }),
          );
          return;
        }

        if (sid) {
          const captured = capturedStore.record(sid, {
            url: upstream.finalUrl,
            mimeType: contentTypeHeader,
            declaredBytes: resolveTotalBytesFromHeaders(upstream.headers, upstream.body),
          });
          if (captured) store.addCapturedResource(sid, captured);
        }

        setFrameable(res);
        applyProxiedSetCookieHeaders(res, upstream.headers);
        if (isSvgAsset(mime, upstream.finalUrl)) {
          const svgBuf = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.text);
          res.status(upstream.statusCode || 200);
          res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.send(sanitizeSvgXml(svgBuf.toString('utf8')));
          return;
        }

        res.status(upstream.statusCode === 206 ? 206 : upstream.statusCode || 200);
        if (isPdfAsset(mime, upstream.finalUrl)) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'inline');
        } else {
          res.setHeader(
            'Content-Type',
            contentTypeHeader || guessMimeTypeFromUrl(upstream.finalUrl),
          );
        }
        const len = getHeaderSingle(upstream.headers['content-length']);
        if (len) res.setHeader('Content-Length', len);
        const ce = getHeaderSingle(upstream.headers['content-encoding']);
        if (ce && ce.trim().toLowerCase() !== 'identity') {
          res.setHeader('Content-Encoding', ce);
        }
        res.setHeader('Cache-Control', method === 'GET' ? 'public, max-age=300' : 'no-store');

        const sourceStream = upstream.stream ?? Readable.from(upstream.body ?? Buffer.alloc(0));
        pipeUpstream(sourceStream, res, req, upstream.cleanup);
        return;
      }

      if (
        !isDebug &&
        bypassExternalLinks &&
        explicitRootUrl &&
        isExternalSiteUrl(upstream.finalUrl, explicitRootUrl)
      ) {
        upstream.cleanup?.();
        setFrameable(res);
        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(
          `<!doctype html><html lang="id"><head><meta charset="utf-8"><script>(function(){try{window.parent.postMessage({type:'cdnfree:external-bypassed',url:${JSON.stringify(upstream.finalUrl)}},'*');}catch(e){}if(history.length>1){history.back();}else{location.replace('/api/proxy?u='+${JSON.stringify(Buffer.from(explicitRootUrl, 'utf8').toString('base64url'))}+${sid ? `'&sid=${encodeURIComponent(sid)}'` : `''`}+'&extbypass=1');}})();</script></head><body></body></html>`,
        );
        return;
      }

      const rootSiteUrl = explicitRootUrl ?? upstream.finalUrl;
      const finalHtmlBuf =
        bufferedHtmlBody ?? (await resolveUpstreamBuffer(upstream, PROXY_LIMITS.html));
      const htmlText = finalHtmlBuf.toString('utf8');
      const shim = buildProxyShim(fallbackOrigin, upstream.finalUrl, sid, {
        bypassExternalLinks,
        rootUrl: rootSiteUrl,
      });
      const { stats, html: rewrittenHtml } = rewriteHtmlDocumentWithStats(
        htmlText,
        upstream.finalUrl,
        '',
        shim,
        sid,
        { bypassExternalLinks, rootUrl: rootSiteUrl, mode: 'light' },
      );

      if (isDebug) {
        res.status(200).json(
          buildProxyDebugPayload({
            upstreamStatus: upstream.statusCode || 200,
            upstreamMime: contentTypeHeader || 'text/html',
            finalUrl: upstream.finalUrl,
            headers: upstream.headers,
            html: htmlText,
            rewritten: stats,
            durationMs: Date.now() - startedAt,
          }),
        );
        return;
      }

      setFrameable(res);
      applyProxiedSetCookieHeaders(res, upstream.headers);
      res.status(upstream.statusCode >= 200 && upstream.statusCode < 600 ? upstream.statusCode : 200);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.send(rewrittenHtml);
    } catch (err) {
      const mapped = mapProxyError(err);
      const acceptsHtml = !isDebug && (req.headers.accept ?? '').includes('text/html');
      setFrameable(res);
      res.status(mapped.httpStatus);
      if (acceptsHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderFriendlyErrorHtml('Halaman tidak dapat dibuka', mapped.message));
        return;
      }
      res.json({
        success: false,
        code: mapped.code,
        error: mapped.message,
      });
    }
  });

  const handleAssetRequest = async (req: Request, res: Response) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!assetRateLimiter.allow(clientKey)) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Terlalu banyak permintaan aset.',
      });
      return;
    }

    const sid = sanitizeSessionId(req.query.sid);
    const isHead = req.method === 'HEAD';
    const secFetchDest = req.get('sec-fetch-dest')?.toLowerCase() ?? '';

    let target: string;
    try {
      const encoded = String(req.query.u ?? '');
      target = normalizeProxyTarget(decodeProxyUrl(encoded));
    } catch {
      res.status(400).end();
      return;
    }

    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const rawRange = getHeaderSingle(req.headers.range);
    const rangeHeader =
      rawRange ?? (isHead && req.query.probe === '1' ? 'bytes=0-1' : undefined);

    let explicitRefUrl: string | undefined;
    if (typeof req.query.ref === 'string' && req.query.ref.trim()) {
      try {
        explicitRefUrl = normalizeProxyTarget(decodeProxyUrl(req.query.ref));
      } catch {
        explicitRefUrl = undefined;
      }
    }

    const pageUrl = explicitRefUrl ?? (sid ? store.get(sid)?.finalUrl : undefined);
    const assetReferer = buildAssetReferer(target, pageUrl);
    const acceptHeader = buildAssetAcceptHeader(target);

    try {
      const upstream = await fetchAssetWithHeaderProfile({
        targetUrl: target,
        pageUrl: assetReferer,
        method: isHead ? 'HEAD' : 'GET',
        rangeHeader,
        acceptHeader,
        cookieJar,
        sid,
        dnsLookup: deps.dnsLookup,
        signal: controller.signal,
        fetchProxy,
      });

      const contentTypeHeader = getHeaderSingle(upstream.headers['content-type']);
      const mime = parseMimeType(contentTypeHeader);
      const resolvedCt = contentTypeHeader || guessMimeTypeFromUrl(upstream.finalUrl);
      const blockHtmlAsMedia =
        secFetchDest !== 'script' &&
        secFetchDest !== 'empty' &&
        (mime === 'text/html' || mime === 'application/xhtml+xml') &&
        isMediaUrlExpectation(target);

      if (!isHead && (upstream.statusCode >= 400 || blockHtmlAsMedia)) {
        upstream.cleanup?.();
        res.status(upstream.statusCode >= 400 ? upstream.statusCode : 502).end();
        return;
      }

      if (sid && !isHead) {
        const totalBytes = resolveTotalBytesFromHeaders(upstream.headers, upstream.body);
        const captured = capturedStore.record(sid, {
          url: upstream.finalUrl,
          pageUrl: store.get(sid)?.finalUrl,
          mimeType: contentTypeHeader || resolvedCt,
          declaredBytes: totalBytes,
        });
        if (captured) store.addCapturedResource(sid, captured);
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges',
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (isHead) {
        upstream.cleanup?.();
        if (isPdfAsset(mime, upstream.finalUrl)) {
          setFrameable(res);
          res.setHeader('Content-Disposition', 'inline');
        }
        res.status(upstream.statusCode === 206 ? 206 : upstream.statusCode || 200);
        applyMediaPassThroughHeaders(res, upstream, resolvedCt);
        res.end();
        return;
      }

      if (isSvgAsset(mime, upstream.finalUrl)) {
        const svgBuf = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.text);
        const sanitizedSvg = sanitizeSvgXml(svgBuf.toString('utf8'));
        res.status(200);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(sanitizedSvg);
        return;
      }

      if (mime === 'text/css') {
        const cssBuf = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.text);
        const rewrittenCss = rewriteCssUrls(
          cssBuf.toString('utf8'),
          upstream.finalUrl,
          '',
          sid,
        );
        res.status(200);
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(rewrittenCss);
        return;
      }

      if (isM3u8Asset(mime, upstream.finalUrl)) {
        const m3u8Buf = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.text);
        const rewrittenPlaylist = rewriteM3u8Playlist(
          m3u8Buf.toString('utf8'),
          upstream.finalUrl,
          '',
          sid,
        );
        res.status(200);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenPlaylist);
        return;
      }

      if (isJavaScriptMime(mime, upstream.finalUrl)) {
        const jsBuf = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.text);
        const rewrittenJs = rewriteEsModuleSpecifiers(
          jsBuf.toString('utf8'),
          upstream.finalUrl,
          '',
          sid,
        );
        res.status(200);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(rewrittenJs);
        return;
      }

      if (isPdfAsset(mime, upstream.finalUrl)) {
        setFrameable(res);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Expose-Headers',
          'Content-Length, Content-Range, Accept-Ranges',
        );
        res.setHeader('Content-Disposition', 'inline');
      }

      sendRangedOrStreamedAsset(req, res, upstream, mime, resolvedCt, rangeHeader);
    } catch (err) {
      const mapped = mapProxyError(err);
      res.status(mapped.httpStatus).end();
    }
  };

  router.head('/asset', handleAssetRequest);
  router.get('/asset', handleAssetRequest);

  router.get('/captured', (req: Request, res: Response) => {
    const sid = sanitizeSessionId(req.query.sid);
    if (!sid) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Parameter sid tidak valid.',
      });
      return;
    }

    res.status(200).json({
      sid,
      resources: capturedStore.list(sid),
    });
  });

  return router;
}

export function createViewRouter(): Router {
  const router = Router();

  router.get('/view', (req: Request, res: Response) => {
    const encoded = String(req.query.u ?? '').trim();
    const sid = sanitizeSessionId(req.query.sid);
    try {
      normalizeProxyTarget(decodeProxyUrl(encoded));
    } catch {
      res.status(400).send(
        renderFriendlyErrorHtml(
          'Alamat tidak valid',
          'Parameter URL untuk viewer penuh tidak valid atau protokol tidak didukung.',
        ),
      );
      return;
    }

    const qs = `u=${encodeURIComponent(encoded)}${sid ? `&sid=${encodeURIComponent(sid)}` : ''}`;
    res.redirect(302, `/api/proxy?${qs}`);
  });

  return router;
}
