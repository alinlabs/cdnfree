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
  getHeaderSingle,
  isJavaScriptMime,
  isM3u8Asset,
  isPdfAsset,
  isSvgAsset,
  mapProxyError,
  renderFriendlyErrorHtml,
  resolveTotalBytesFromHeaders,
  resolveUpstreamBuffer,
} from '../services/proxy/asset-route-helpers.ts';
import {
  CapturedAssetStore,
  defaultCapturedAssetStore,
} from '../services/proxy/captured-store.ts';
import {
  rewriteCssUrls,
  rewriteEsModuleSpecifiers,
  rewriteHtmlDocument,
  rewriteM3u8Playlist,
} from '../services/proxy/rewrite.ts';
import {
  safeProxyFetch,
  type SafeProxyFetchOptions,
  type SafeProxyFetchResult,
} from '../services/proxy/safe-proxy-fetch.ts';
import {
  createByteRangeSliceStream,
  guessMimeTypeFromUrl,
  parseSingleRange,
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

export function createProxyRouter(
  deps: ProxyRouterDependencies = {},
): Router {
  const router = Router();
  const store = deps.store ?? defaultInspectionStore;
  const capturedStore = deps.capturedStore ?? defaultCapturedAssetStore;
  const proxyRateLimiter =
    deps.proxyRateLimiter ?? new SlidingWindowRateLimiter(60_000, 30);
  const assetRateLimiter =
    deps.assetRateLimiter ?? new SlidingWindowRateLimiter(60_000, 300);
  const fetchProxy = deps.fetchProxy ?? safeProxyFetch;

  router.get('/proxy', async (req: Request, res: Response) => {
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
      let upstream = await fetchProxy(target, {
        stream: true,
        dnsLookup: deps.dnsLookup,
        signal: controller.signal,
      });

      let bufferedHtmlBody: Buffer | null = null;
      const visitedProxyUrls = new Set<string>([upstream.finalUrl.split('#')[0]]);

      for (let clientHop = 0; clientHop < MAX_REDIRECT_HOPS; clientHop += 1) {
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
          stream: true,
          dnsLookup: deps.dnsLookup,
          signal: controller.signal,
        });
      }

      const contentTypeHeader = getHeaderSingle(upstream.headers['content-type']);
      const mime = parseMimeType(contentTypeHeader);

      if (mime !== 'text/html' && mime !== 'application/xhtml+xml' && mime !== '') {
        if (sid) {
          const captured = capturedStore.record(sid, {
            url: upstream.finalUrl,
            mimeType: contentTypeHeader,
            declaredBytes: resolveTotalBytesFromHeaders(upstream.headers, upstream.body),
          });
          if (captured) store.addCapturedResource(sid, captured);
        }

        setFrameable(res);
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
        res.setHeader('Cache-Control', 'public, max-age=300');

        const sourceStream = upstream.stream ?? Readable.from(upstream.body ?? Buffer.alloc(0));
        pipeUpstream(sourceStream, res, req, upstream.cleanup);
        return;
      }

      if (
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
      const rewrittenHtml = rewriteHtmlDocument(
        htmlText,
        upstream.finalUrl,
        '',
        shim,
        sid,
        { bypassExternalLinks, rootUrl: rootSiteUrl },
      );

      setFrameable(res);
      res.status(upstream.statusCode >= 200 && upstream.statusCode < 600 ? upstream.statusCode : 200);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.send(rewrittenHtml);
    } catch (err) {
      const mapped = mapProxyError(err);
      const acceptsHtml = (req.headers.accept ?? '').includes('text/html');
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

    const pageUrl = sid ? store.get(sid)?.finalUrl : undefined;
    const assetReferer = buildAssetReferer(target, pageUrl);

    try {
      const upstream = await fetchProxy(target, {
        method: isHead ? 'HEAD' : 'GET',
        range: rangeHeader,
        headers: assetReferer ? { Referer: assetReferer } : undefined,
        stream: true,
        dnsLookup: deps.dnsLookup,
        signal: controller.signal,
      });

      const contentTypeHeader = getHeaderSingle(upstream.headers['content-type']);
      const mime = parseMimeType(contentTypeHeader);
      const resolvedCt = contentTypeHeader || guessMimeTypeFromUrl(upstream.finalUrl);

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

      const sourceStream = upstream.stream ?? Readable.from(upstream.body ?? Buffer.alloc(0));
      const upstreamCe = getHeaderSingle(upstream.headers['content-encoding'])?.trim().toLowerCase();
      const hasRawEncoding = Boolean(upstreamCe && upstreamCe !== 'identity');
      const upstreamLenHeader = getHeaderSingle(upstream.headers['content-length']);
      const totalLen =
        upstreamLenHeader && /^\d+$/.test(upstreamLenHeader.trim())
          ? Number(upstreamLenHeader.trim())
          : upstream.body?.length;

      if (
        rangeHeader &&
        upstream.statusCode === 200 &&
        !hasRawEncoding &&
        typeof totalLen === 'number' &&
        totalLen > 0
      ) {
        const parsedRange = parseSingleRange(rangeHeader, totalLen);
        if (parsedRange.ok) {
          const { start, end } = parsedRange;
          const sliceLen = end - start + 1;
          res.status(206);
          res.setHeader('Content-Type', isPdfAsset(mime, upstream.finalUrl) ? 'application/pdf' : resolvedCt);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLen}`);
          res.setHeader('Content-Length', String(sliceLen));
          res.setHeader('Cache-Control', 'public, max-age=86400');

          const slicer = createByteRangeSliceStream(start, end, () => {
            sourceStream.destroy();
            upstream.cleanup?.();
          });
          sourceStream.on('error', () => slicer.destroy());
          const slicedStream = sourceStream.pipe(slicer);
          pipeUpstream(slicedStream, res, req, () => {
            sourceStream.destroy();
            upstream.cleanup?.();
          });
          return;
        }
        if (parsedRange.reason === 'unsatisfiable') {
          sourceStream.destroy();
          upstream.cleanup?.();
          res.status(416);
          res.setHeader('Content-Range', `bytes */${totalLen}`);
          res.end();
          return;
        }
      }

      res.status(upstream.statusCode === 206 ? 206 : upstream.statusCode || 200);
      applyMediaPassThroughHeaders(
        res,
        upstream,
        isPdfAsset(mime, upstream.finalUrl) ? 'application/pdf' : resolvedCt,
      );
      if (!upstreamLenHeader && upstream.body) {
        res.setHeader('Content-Length', String(upstream.body.length));
      }
      res.setHeader('Cache-Control', 'public, max-age=86400');

      pipeUpstream(sourceStream, res, req, upstream.cleanup);
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
