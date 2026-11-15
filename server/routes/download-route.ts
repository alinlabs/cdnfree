import { Transform } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ASSET_DOWNLOAD_TIMEOUT_MS,
  ConcurrencyLimiter,
  MAX_CONCURRENT_DOWNLOADS,
  SlidingWindowRateLimiter,
} from '../security/request-limits.ts';
import {
  prepareAssetDownload,
  type FallbackResourceDescriptor,
  type FetchAssetHopFn,
} from '../services/asset-downloader.ts';
import {
  InspectionStore,
  defaultInspectionStore,
} from '../services/inspection-store.ts';
import { decodeProxyUrl, normalizeProxyTarget } from '../services/proxy/urlcodec.ts';
import {
  InspectionPolicyError,
  type DnsLookupFn,
} from '../types/server.ts';

const DownloadBodySchema = z.object({
  inspectionId: z.string().uuid(),
  resourceId: z.string().trim().min(1).max(120),
});

const ASSET_KIND_SET = new Set([
  'image',
  'vector',
  'video',
  'audio',
  'font',
  'stylesheet',
  'pdf',
  'json',
  'hls',
  'dash',
  'wrapper',
  'embed',
  'other',
]);

const RESOURCE_KIND_SET = new Set([
  'image',
  'video',
  'audio',
  'script',
  'stylesheet',
  'font',
  'document',
  'other',
]);

export interface DownloadRouterDependencies {
  store?: InspectionStore;
  concurrencyLimiter?: ConcurrencyLimiter;
  rateLimiter?: SlidingWindowRateLimiter;
  dnsLookup?: DnsLookupFn;
  fetchAssetHop?: FetchAssetHopFn;
  maxBytes?: number;
}

export function createDownloadRouter(
  deps: DownloadRouterDependencies = {},
): Router {
  const router = Router();
  const store = deps.store ?? defaultInspectionStore;
  const concurrencyLimiter =
    deps.concurrencyLimiter ?? new ConcurrencyLimiter(MAX_CONCURRENT_DOWNLOADS);
  const rateLimiter = deps.rateLimiter ?? new SlidingWindowRateLimiter();

  const handleAssetDownload = async (
    inspectionId: string,
    resourceId: string,
    fallbackResource: FallbackResourceDescriptor | undefined,
    req: Request,
    res: Response,
  ) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!rateLimiter.allow(clientKey)) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan unduhan aset. Coba lagi sebentar lagi.',
      });
      return;
    }

    const parsedParams = DownloadBodySchema.safeParse({ inspectionId, resourceId });
    if (!parsedParams.success) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Referensi aset atau sesi inspeksi tidak valid.',
      });
      return;
    }

    if (!concurrencyLimiter.tryAcquire()) {
      res.status(429).json({
        code: 'SERVER_BUSY',
        message: 'Layanan unduhan sedang sibuk. Silakan coba beberapa saat lagi.',
      });
      return;
    }

    const controller = new AbortController();
    let activeAbort: (() => void) | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanedUp = false;

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearIdleTimer();
      res.off('close', handleResponseClose);
      res.off('finish', cleanup);
      concurrencyLimiter.release();
    };

    const handleResponseClose = () => {
      if (!res.writableEnded) {
        controller.abort();
        activeAbort?.();
      }
    };
    res.on('close', handleResponseClose);

    try {
      const prepared = await prepareAssetDownload({
        store,
        inspectionId: parsedParams.data.inspectionId,
        resourceId: parsedParams.data.resourceId,
        fallbackResource,
        dnsLookup: deps.dnsLookup,
        fetchAssetHop: deps.fetchAssetHop,
        maxBytes: deps.maxBytes,
        signal: controller.signal,
      });

      if (res.writableEnded || controller.signal.aborted) {
        prepared.abort();
        cleanup();
        return;
      }

      activeAbort = prepared.abort;

      let totalBytes = 0;
      let headersWritten = false;

      const writeHeadersOnce = () => {
        if (headersWritten) return;
        headersWritten = true;
        const encodedName = encodeURIComponent(prepared.filename);
        const asciiFilename = prepared.filename
          .replace(/[^\x20-\x7e]/g, '_')
          .replace(/["\\]/g, '_');
        res.status(200);
        res.setHeader('Content-Type', prepared.contentType);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedName}`,
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        res.setHeader('Cache-Control', 'no-store');
        if (typeof prepared.contentLength === 'number') {
          res.setHeader('Content-Length', String(prepared.contentLength));
        }
      };

      const resetIdleTimer = () => {
        clearIdleTimer();
        idleTimer = setTimeout(() => {
          prepared.abort();
          if (!headersWritten && !res.headersSent) {
            res.status(408).json({
              code: 'TIMEOUT',
              message: 'Waktu unduhan aset habis karena aliran data terhenti.',
            });
          } else if (!res.writableEnded) {
            res.destroy();
          }
          cleanup();
        }, ASSET_DOWNLOAD_TIMEOUT_MS);
      };

      resetIdleTimer();

      const byteLimiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          resetIdleTimer();
          totalBytes += chunk.length;
          if (totalBytes > prepared.maxBytes) {
            prepared.abort();
            callback(
              new InspectionPolicyError(
                'RESPONSE_TOO_LARGE',
                'Aset tidak dapat diunduh karena ukurannya melebihi batas maksimum server.',
                413,
              ),
            );
            return;
          }
          writeHeadersOnce();
          callback(null, chunk);
        },
        flush(callback) {
          writeHeadersOnce();
          callback();
        },
      });

      prepared.stream.on('error', () => {
        prepared.abort();
        if (!headersWritten && !res.headersSent) {
          res.status(502).json({
            code: 'UPSTREAM_ERROR',
            message: 'Aset tidak dapat diunduh karena aliran data dari host asal terputus.',
          });
        } else if (!res.writableEnded) {
          res.destroy();
        }
        cleanup();
      });

      byteLimiter.on('error', (err) => {
        prepared.abort();
        if (!headersWritten && !res.headersSent) {
          const status =
            err instanceof InspectionPolicyError ? err.httpStatus : 502;
          const message =
            err instanceof InspectionPolicyError
              ? err.message
              : 'Aset tidak dapat diunduh.';
          res.status(status).json({
            code: err instanceof InspectionPolicyError ? err.code : 'UPSTREAM_ERROR',
            message,
          });
        } else if (!res.writableEnded) {
          res.destroy();
        }
        cleanup();
      });

      res.on('finish', cleanup);
      prepared.stream.pipe(byteLimiter).pipe(res);
    } catch (err) {
      if (res.writableEnded || controller.signal.aborted) {
        cleanup();
        return;
      }

      if (err instanceof InspectionPolicyError) {
        res.status(err.httpStatus).json({
          code: err.code,
          message: err.message,
        });
        cleanup();
        return;
      }

      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Aset tidak dapat diunduh karena terjadi kesalahan internal.',
      });
      cleanup();
    }
  };

  router.post('/assets/download', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      inspectionId?: unknown;
      resourceId?: unknown;
      url?: unknown;
      referer?: unknown;
      assetKind?: unknown;
      kind?: unknown;
      mimeType?: unknown;
    };
    let fallbackResource: FallbackResourceDescriptor | undefined;
    if (typeof body.url === 'string' && body.url.trim()) {
      try {
        const normalizedUrl = normalizeProxyTarget(body.url);
        let normalizedRef: string | undefined;
        if (typeof body.referer === 'string' && body.referer.trim()) {
          try {
            normalizedRef = normalizeProxyTarget(body.referer);
          } catch {
            normalizedRef = undefined;
          }
        }
        fallbackResource = {
          url: normalizedUrl,
          referer: normalizedRef,
          assetKind:
            typeof body.assetKind === 'string' && ASSET_KIND_SET.has(body.assetKind)
              ? (body.assetKind as FallbackResourceDescriptor['assetKind'])
              : undefined,
          kind:
            typeof body.kind === 'string' && RESOURCE_KIND_SET.has(body.kind)
              ? (body.kind as FallbackResourceDescriptor['kind'])
              : undefined,
          mimeType:
            typeof body.mimeType === 'string' && body.mimeType.trim()
              ? body.mimeType.trim().slice(0, 120)
              : undefined,
        };
      } catch {
        fallbackResource = undefined;
      }
    }
    void handleAssetDownload(
      typeof body.inspectionId === 'string' ? body.inspectionId : '',
      typeof body.resourceId === 'string' ? body.resourceId : '',
      fallbackResource,
      req,
      res,
    );
  });

  router.get('/assets/:sid/:assetId/download', (req: Request, res: Response) => {
    let fallbackResource: FallbackResourceDescriptor | undefined;
    if (typeof req.query.u === 'string' && req.query.u.trim()) {
      try {
        const normalizedUrl = normalizeProxyTarget(decodeProxyUrl(req.query.u));
        let normalizedRef: string | undefined;
        if (typeof req.query.ref === 'string' && req.query.ref.trim()) {
          try {
            normalizedRef = normalizeProxyTarget(decodeProxyUrl(req.query.ref));
          } catch {
            normalizedRef = undefined;
          }
        }
        fallbackResource = {
          url: normalizedUrl,
          referer: normalizedRef,
          assetKind:
            typeof req.query.ak === 'string' && ASSET_KIND_SET.has(req.query.ak)
              ? (req.query.ak as FallbackResourceDescriptor['assetKind'])
              : undefined,
          mimeType:
            typeof req.query.ct === 'string' && req.query.ct.trim()
              ? req.query.ct.trim().slice(0, 120)
              : undefined,
        };
      } catch {
        fallbackResource = undefined;
      }
    }
    void handleAssetDownload(
      String(req.params.sid ?? ''),
      String(req.params.assetId ?? ''),
      fallbackResource,
      req,
      res,
    );
  });

  return router;
}
