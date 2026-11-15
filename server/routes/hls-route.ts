import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  HEADER_LADDER,
  HLS_REMINT_WINDOW_SEC,
  RETRYABLE_STATUS,
} from '../config/limits.ts';
import { SlidingWindowRateLimiter } from '../security/request-limits.ts';
import { openPinnedStream, type PinnedStreamResponse } from '../services/fetch-head-bytes.ts';
import { getProfile, recordFailure, recordSuccess } from '../services/header-profile-store.ts';
import {
  buildPlaylistContext,
  decodeHlsChildUrl,
  parseExpiry,
  rewritePlaylist,
} from '../services/hls-playlist.ts';
import { reMintPlaylist } from '../services/hls-remint.ts';
import {
  InspectionStore,
  defaultInspectionStore,
} from '../services/inspection-store.ts';
import { pipeUpstream } from '../services/proxy/stream-response.ts';
import { defaultDnsLookup, resolveAndValidateUrl } from '../services/url-policy.ts';
import { InspectionPolicyError, type DnsLookupFn } from '../types/server.ts';

const InspectionIdSchema = z.string().uuid();
const AssetIdSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]{4,64}$/);
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;

export interface HlsRouterDependencies {
  store?: InspectionStore;
  dnsLookup?: DnsLookupFn;
  rateLimiter?: SlidingWindowRateLimiter;
  openStream?: typeof openPinnedStream;
  reMint?: typeof reMintPlaylist;
}

function headerSingle(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function inheritRootTokenQuery(targetUrl: string, rootUrl: string): string {
  try {
    const target = new URL(targetUrl);
    const root = new URL(rootUrl);
    if (!target.search && target.origin === root.origin && root.search) {
      target.search = root.search;
      return target.href;
    }
    return target.href;
  } catch {
    return targetUrl;
  }
}

async function fetchWithAdaptiveHeaders(
  targetUrl: string,
  pageUrl: string | null,
  dnsLookup: DnsLookupFn,
  signal: AbortSignal,
  openStream: typeof openPinnedStream,
  rangeHeader?: string,
): Promise<PinnedStreamResponse> {
  const host = new URL(targetUrl).hostname;
  const learned = getProfile(host);
  const modes = learned
    ? [learned.mode, ...HEADER_LADDER.filter((m) => m !== learned.mode)]
    : [...HEADER_LADDER];

  let lastResponse: PinnedStreamResponse | null = null;
  for (const mode of modes) {
    await resolveAndValidateUrl(targetUrl, dnsLookup);
    const opened = await openStream(targetUrl, pageUrl, mode, {
      dnsLookup,
      signal,
      maxRedirects: 4,
      extraHeaders: rangeHeader ? { Range: rangeHeader } : undefined,
    });

    if (RETRYABLE_STATUS.has(opened.status)) {
      if (learned?.mode === mode) recordFailure(host);
      lastResponse?.abort();
      lastResponse = opened;
      continue;
    }

    lastResponse?.abort();
    let origin: string | null = null;
    if (pageUrl) {
      try {
        origin = new URL(pageUrl).origin;
      } catch {
        origin = null;
      }
    }
    if (opened.status >= 200 && opened.status < 300) {
      recordSuccess(host, mode, pageUrl, origin);
    }
    return opened;
  }

  if (lastResponse) return lastResponse;
  throw new InspectionPolicyError('UPSTREAM_ERROR', 'Gagal membuka aliran HLS.', 502);
}

async function readStreamUpTo(
  opened: PinnedStreamResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const raw of opened.stream) {
      if (signal.aborted) {
        opened.abort();
        throw new InspectionPolicyError('ABORTED', 'Permintaan HLS dibatalkan.', 499);
      }
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      total += chunk.length;
      if (total > maxBytes) {
        opened.abort();
        throw new InspectionPolicyError(
          'RESPONSE_TOO_LARGE',
          'Ukuran playlist HLS melebihi batas maksimum.',
          413,
        );
      }
      chunks.push(chunk);
    }
  } finally {
    opened.abort();
  }
  return Buffer.concat(chunks, total);
}

export function createHlsRouter(deps: HlsRouterDependencies = {}): Router {
  const router = Router();
  const store = deps.store ?? defaultInspectionStore;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const openStream = deps.openStream ?? openPinnedStream;
  const reMint = deps.reMint ?? reMintPlaylist;
  const rateLimiter =
    deps.rateLimiter ?? new SlidingWindowRateLimiter(60_000, 2400);

  const handleHls = async (req: Request, res: Response) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!rateLimiter.allow(clientKey)) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan segmen HLS.',
      });
      return;
    }

    const parsedSid = InspectionIdSchema.safeParse(req.params.sid);
    const parsedAssetId = AssetIdSchema.safeParse(req.params.assetId);
    if (!parsedSid.success || !parsedAssetId.success) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Parameter sesi atau aset HLS tidak valid.',
      });
      return;
    }

    const sid = parsedSid.data;
    const assetId = parsedAssetId.data;
    const inspection = store.get(sid);
    if (!inspection) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Sesi inspeksi tidak ditemukan atau kedaluwarsa.',
      });
      return;
    }

    const asset = inspection.resources.find((r) => r.id === assetId);
    if (!asset) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Aset HLS tidak ditemukan.',
      });
      return;
    }

    const rawChildParam =
      typeof req.query.u === 'string' ? req.query.u.trim() : '';
    const isChildRequest = Boolean(rawChildParam);
    let targetUrl = asset.url;

    if (isChildRequest) {
      const decoded = decodeHlsChildUrl(rawChildParam);
      if (!decoded) {
        res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'URL segmen HLS tidak valid.',
        });
        return;
      }
      targetUrl = inheritRootTokenQuery(decoded, asset.url);
    }

    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const refererUrl = asset.referer ?? inspection.finalUrl ?? null;
    const rangeHeader = headerSingle(req.headers.range);

    try {
      if (!isChildRequest) {
        const expEpochSec = parseExpiry(targetUrl);
        if (
          expEpochSec !== null &&
          expEpochSec - Math.floor(Date.now() / 1000) <= HLS_REMINT_WINDOW_SEC
        ) {
          const minted = await reMint(store, sid, assetId, {
            dnsLookup,
            signal: controller.signal,
          });
          if (minted.ok && minted.url) {
            targetUrl = minted.url;
          }
        }
      }

      let opened = await fetchWithAdaptiveHeaders(
        targetUrl,
        refererUrl,
        dnsLookup,
        controller.signal,
        openStream,
        rangeHeader,
      );

      if (!isChildRequest && (opened.status === 403 || opened.status === 401)) {
        opened.abort();
        const minted = await reMint(store, sid, assetId, {
          dnsLookup,
          signal: controller.signal,
        });
        if (minted.ok && minted.url && minted.url !== targetUrl) {
          targetUrl = minted.url;
          opened = await fetchWithAdaptiveHeaders(
            targetUrl,
            refererUrl,
            dnsLookup,
            controller.signal,
            openStream,
            rangeHeader,
          );
        }
      }

      if (opened.status >= 400) {
        const errStatus = opened.status;
        opened.abort();
        res.status(errStatus).json({
          code: errStatus === 403 ? 'PROHIBITED_DESTINATION' : 'UPSTREAM_ERROR',
          message: `Server HLS asal mengembalikan status HTTP ${errStatus}.`,
        });
        return;
      }

      const ct = (headerSingle(opened.headers['content-type']) ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const looksLikePlaylist =
        ct.includes('mpegurl') || /\.m3u8(?:$|[?#])/i.test(opened.finalUrl);

      if (looksLikePlaylist) {
        if (req.method === 'HEAD') {
          opened.abort();
          res.status(200);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
          res.end();
          return;
        }

        const buf = await readStreamUpTo(opened, MAX_PLAYLIST_BYTES, controller.signal);
        const rawBody = buf.toString('utf8');
        const ctx = buildPlaylistContext(sid, assetId, opened.finalUrl, asset.url);
        const rewritten = rewritePlaylist(rawBody, ctx);

        res.status(200);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Length', String(Buffer.byteLength(rewritten, 'utf8')));
        res.send(rewritten);
        return;
      }

      if (req.method === 'HEAD') {
        opened.abort();
        res.status(opened.status === 206 ? 206 : opened.status || 200);
        res.setHeader('Content-Type', ct || 'video/mp2t');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        const len = headerSingle(opened.headers['content-length']);
        if (len) res.setHeader('Content-Length', len);
        res.end();
        return;
      }

      res.status(opened.status === 206 ? 206 : opened.status || 200);
      res.setHeader('Content-Type', ct || 'video/mp2t');
      res.setHeader(
        'Accept-Ranges',
        headerSingle(opened.headers['accept-ranges']) ?? 'bytes',
      );
      res.setHeader('Cache-Control', 'private, max-age=120');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      const len = headerSingle(opened.headers['content-length']);
      if (len) res.setHeader('Content-Length', len);
      const cr = headerSingle(opened.headers['content-range']);
      if (cr) res.setHeader('Content-Range', cr);

      pipeUpstream(opened.stream, res, req, opened.abort);
    } catch (err) {
      if (err instanceof InspectionPolicyError) {
        res.status(err.httpStatus).json({
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(502).json({
        code: 'UPSTREAM_ERROR',
        message: 'Aliran HLS gagal diambil dari server asal.',
      });
    }
  };

  router.head('/hls/:sid/:assetId', handleHls);
  router.get('/hls/:sid/:assetId', handleHls);

  return router;
}
