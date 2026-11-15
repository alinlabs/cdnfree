import { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PROXY_LIMITS,
  SlidingWindowRateLimiter,
  parseMimeType,
} from '../security/request-limits.ts';
import {
  InspectionStore,
  defaultInspectionStore,
} from '../services/inspection-store.ts';
import { normalizeMimeForAsset } from '../services/asset-classify.ts';
import {
  getHeaderSingle,
  isSvgAsset,
  mapProxyError,
  resolveTotalBytesFromHeaders,
  resolveUpstreamBuffer,
} from '../services/proxy/asset-route-helpers.ts';
import {
  safeProxyFetch,
  type SafeProxyFetchOptions,
  type SafeProxyFetchResult,
} from '../services/proxy/safe-proxy-fetch.ts';
import {
  createByteRangeSliceStream,
  parseSingleRange,
  pipeUpstream,
} from '../services/proxy/stream-response.ts';
import { sanitizeSvgXml } from '../services/proxy/svg-sanitizer.ts';
import { defaultDnsLookup, resolveAndValidateUrl } from '../services/url-policy.ts';
import { InspectionPolicyError, type DnsLookupFn } from '../types/server.ts';

export const DEFAULT_MAX_STREAM_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const STREAM_SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'";

const InspectionIdSchema = z.string().uuid();
const AssetIdSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]{4,64}$/);

export interface StreamRouterDependencies {
  store?: InspectionStore;
  rateLimiter?: SlidingWindowRateLimiter;
  dnsLookup?: DnsLookupFn;
  fetchProxy?: (
    rawUrl: string,
    options?: SafeProxyFetchOptions,
  ) => Promise<SafeProxyFetchResult>;
  maxStreamBytes?: number;
}

function forwardCommonStreamHeaders(
  res: Response,
  upstream: SafeProxyFetchResult,
  contentType: string,
): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  const acceptRanges = getHeaderSingle(upstream.headers['accept-ranges']);
  res.setHeader('Accept-Ranges', acceptRanges ?? 'bytes');

  const etag = getHeaderSingle(upstream.headers.etag);
  if (etag) res.setHeader('ETag', etag);

  const lastModified = getHeaderSingle(upstream.headers['last-modified']);
  if (lastModified) res.setHeader('Last-Modified', lastModified);
}

export function createStreamRouter(
  deps: StreamRouterDependencies = {},
): Router {
  const router = Router();
  const store = deps.store ?? defaultInspectionStore;
  const rateLimiter =
    deps.rateLimiter ?? new SlidingWindowRateLimiter(60_000, 1200);
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const fetchProxy = deps.fetchProxy ?? safeProxyFetch;
  const maxStreamBytes = deps.maxStreamBytes ?? DEFAULT_MAX_STREAM_BYTES;

  const handleStream = async (req: Request, res: Response) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!rateLimiter.allow(clientKey)) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan aliran aset.',
      });
      return;
    }

    const parsedInspectionId = InspectionIdSchema.safeParse(req.params.inspectionId);
    const parsedAssetId = AssetIdSchema.safeParse(req.params.assetId);
    if (!parsedInspectionId.success || !parsedAssetId.success) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Parameter inspeksi atau aset tidak valid.',
      });
      return;
    }

    const inspection = store.get(parsedInspectionId.data);
    if (!inspection) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Sesi inspeksi tidak ditemukan atau sudah kedaluwarsa.',
      });
      return;
    }

    const asset = inspection.resources.find(
      (item) => item.id === parsedAssetId.data,
    );
    if (!asset) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Aset tidak ditemukan pada sesi inspeksi ini.',
      });
      return;
    }

    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const isHead = req.method === 'HEAD';
    const rangeHeader = getHeaderSingle(req.headers.range);

    try {
      // Always re-run DNS & SSRF validation before opening outbound socket
      await resolveAndValidateUrl(asset.url, dnsLookup);

      const acceptHeader =
        asset.kind === 'image'
          ? 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          : '*/*';

      let upstream = await fetchProxy(asset.url, {
        method: isHead ? 'HEAD' : 'GET',
        range: rangeHeader,
        headers: {
          Accept: acceptHeader,
          Referer: asset.referer ?? inspection.finalUrl,
        },
        stream: true,
        dnsLookup,
        signal: controller.signal,
      });

      if (
        upstream.statusCode === 401 ||
        upstream.statusCode === 403 ||
        upstream.statusCode === 406
      ) {
        upstream.cleanup?.();
        upstream = await fetchProxy(asset.url, {
          method: isHead ? 'HEAD' : 'GET',
          range: rangeHeader,
          headers: {
            Accept: acceptHeader,
          },
          stream: true,
          dnsLookup,
          signal: controller.signal,
        });
      }

      const totalBytes = resolveTotalBytesFromHeaders(
        upstream.headers,
        upstream.body,
      );
      const bypassDefaultRangeCap =
        deps.maxStreamBytes === undefined &&
        Boolean(rangeHeader) &&
        (asset.kind === 'video' || asset.kind === 'audio');
      if (
        !bypassDefaultRangeCap &&
        typeof totalBytes === 'number' &&
        totalBytes > maxStreamBytes
      ) {
        upstream.cleanup?.();
        res.status(413).json({
          code: 'RESPONSE_TOO_LARGE',
          message: 'Ukuran aset melebihi batas streaming maksimum.',
        });
        return;
      }

      const rawCt = getHeaderSingle(upstream.headers['content-type']);
      const parsedMime = parseMimeType(rawCt);
      const effectiveCt = normalizeMimeForAsset(upstream.finalUrl, rawCt || asset.mimeType);

      if (
        !isHead &&
        (upstream.statusCode >= 400 ||
          ((parsedMime === 'text/html' || parsedMime === 'application/xhtml+xml') &&
            (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio')))
      ) {
        upstream.cleanup?.();
        res.status(upstream.statusCode >= 400 ? upstream.statusCode : 502).json({
          code: 'UPSTREAM_ERROR',
          message: 'Server sumber tidak mengembalikan media yang valid.',
        });
        return;
      }

      if (isSvgAsset(parsedMime, upstream.finalUrl) || effectiveCt.startsWith('image/svg+xml')) {
        if (isHead) {
          upstream.cleanup?.();
          res.status(upstream.statusCode || 200);
          forwardCommonStreamHeaders(res, upstream, 'image/svg+xml; charset=utf-8');
          res.setHeader('Content-Security-Policy', STREAM_SVG_CSP);
          const len = getHeaderSingle(upstream.headers['content-length']);
          if (len) res.setHeader('Content-Length', len);
          res.end();
          return;
        }

        const svgBuf = await resolveUpstreamBuffer(upstream, PROXY_LIMITS.text);
        const sanitized = sanitizeSvgXml(svgBuf.toString('utf8'));
        res.status(200);
        forwardCommonStreamHeaders(res, upstream, 'image/svg+xml; charset=utf-8');
        res.setHeader('Content-Security-Policy', STREAM_SVG_CSP);
        res.setHeader('Content-Length', String(Buffer.byteLength(sanitized, 'utf8')));
        res.send(sanitized);
        return;
      }

      if (isHead) {
        upstream.cleanup?.();
        res.status(upstream.statusCode === 206 ? 206 : upstream.statusCode || 200);
        forwardCommonStreamHeaders(res, upstream, effectiveCt);
        const len = getHeaderSingle(upstream.headers['content-length']);
        if (len) res.setHeader('Content-Length', len);
        const cr = getHeaderSingle(upstream.headers['content-range']);
        if (cr) res.setHeader('Content-Range', cr);
        res.end();
        return;
      }

      const sourceStream =
        upstream.stream ?? Readable.from(upstream.body ?? Buffer.alloc(0));
      const upstreamCe = getHeaderSingle(upstream.headers['content-encoding'])
        ?.trim()
        .toLowerCase();
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
          forwardCommonStreamHeaders(res, upstream, effectiveCt);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLen}`);
          res.setHeader('Content-Length', String(sliceLen));

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
      forwardCommonStreamHeaders(res, upstream, effectiveCt);
      if (upstreamLenHeader) {
        res.setHeader('Content-Length', upstreamLenHeader);
      } else if (upstream.body) {
        res.setHeader('Content-Length', String(upstream.body.length));
      }
      const cr = getHeaderSingle(upstream.headers['content-range']);
      if (cr) res.setHeader('Content-Range', cr);
      if (hasRawEncoding && upstreamCe) {
        res.setHeader('Content-Encoding', upstreamCe);
      }

      pipeUpstream(sourceStream, res, req, upstream.cleanup);
    } catch (err) {
      if (err instanceof InspectionPolicyError) {
        res.status(err.httpStatus).json({
          code: err.code,
          message: err.message,
        });
        return;
      }
      const mapped = mapProxyError(err);
      res.status(mapped.httpStatus).json({
        code: mapped.code,
        message: mapped.message,
      });
    }
  };

  router.head('/assets/stream/:inspectionId/:assetId', handleStream);
  router.get('/assets/stream/:inspectionId/:assetId', handleStream);

  return router;
}
