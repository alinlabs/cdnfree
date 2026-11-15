import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { PassThrough, Transform } from 'node:stream';
import { CHROME_UA, SNIFF_BYTES } from '../config/limits.ts';
import { isProhibitedIp } from '../security/ip-policy.ts';
import {
  MAX_HTML_BYTES,
  REQUEST_TIMEOUT_MS,
  isAllowedHtmlContentType,
  isDirectInspectableAssetContentType,
  parseMimeType,
} from '../security/request-limits.ts';
import { InspectionPolicyError, type AssetKind } from '../types/server.ts';
import { sniffKind } from './content-sniff.ts';
import { parseTotalBytes } from './fetch-head-bytes.ts';
import { reconcile } from './reconcile.ts';
import type { ValidatedTarget } from './url-policy.ts';

export type HopFetchOutcome =
  | {
      kind: 'redirect';
      statusCode: number;
      location: string;
      headers: http.IncomingHttpHeaders;
    }
  | {
      kind: 'document';
      statusCode: number;
      contentType: string;
      bodyText: string;
      headers: http.IncomingHttpHeaders;
      isWrapper?: boolean;
    }
  | {
      kind: 'asset';
      statusCode: number;
      contentType: string;
      assetKind?: AssetKind;
      declaredBytes?: number;
      headers: http.IncomingHttpHeaders;
    };

export type FetchHopFn = (
  target: ValidatedTarget,
  signal?: AbortSignal,
) => Promise<HopFetchOutcome>;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function createByteLimiter(maxBytes: number, onLimit: () => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        onLimit();
        callback(
          new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran halaman melebihi batas maksimum 2 MiB.',
            413,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

export function isAuthOrAccessChallenge(
  statusCode: number,
  headers: http.IncomingHttpHeaders,
): boolean {
  return (
    statusCode === 401 ||
    statusCode === 402 ||
    statusCode === 403 ||
    Boolean(headers['www-authenticate'])
  );
}

export function safeFetchHop(
  target: ValidatedTarget,
  signal?: AbortSignal,
): Promise<HopFetchOutcome> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new InspectionPolicyError('ABORTED', 'Pemeriksaan tautan dibatalkan.', 499),
      );
      return;
    }

    const isHttps = target.url.protocol === 'https:';
    const transport = isHttps ? https : http;
    let settled = false;
    let wallClockTimer: ReturnType<typeof setTimeout> | null = null;
    let activeRes: http.IncomingMessage | null = null;
    let activeDecoder: Transform | null = null;

    const clearWallTimer = () => {
      if (wallClockTimer) {
        clearTimeout(wallClockTimer);
        wallClockTimer = null;
      }
    };

    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearWallTimer();
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    };

    const finishSuccess = (outcome: HopFetchOutcome) => {
      if (settled) return;
      settled = true;
      clearWallTimer();
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    const requestOptions: https.RequestOptions = {
      method: 'GET',
      agent: false,
      hostname: target.hostname,
      port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
      path: `${target.url.pathname}${target.url.search}`,
      servername:
        isHttps && net.isIP(target.hostname) === 0 ? target.hostname : undefined,
      rejectUnauthorized: true,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Host: target.url.host,
        'User-Agent': CHROME_UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,video/*,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      lookup: (_hostname, options, callback) => {
        if (options && typeof options === 'object' && options.all) {
          callback(null, [
            {
              address: target.pinnedAddress.address,
              family: target.pinnedAddress.family,
            },
          ]);
          return;
        }
        callback(
          null,
          target.pinnedAddress.address,
          target.pinnedAddress.family,
        );
      },
    };

    const req = transport.request(requestOptions, (res) => {
      activeRes = res;
      const statusCode = res.statusCode ?? 0;

      if (REDIRECT_STATUS_CODES.has(statusCode)) {
        const rawLocation = res.headers.location;
        const location = Array.isArray(rawLocation)
          ? rawLocation[0]
          : rawLocation;
        res.resume();

        if (!location || !location.trim()) {
          finishError(
            new InspectionPolicyError(
              'INVALID_REDIRECT',
              'Server tujuan mengirim pengalihan tanpa alamat Location yang valid.',
              502,
            ),
          );
          return;
        }

        finishSuccess({
          kind: 'redirect',
          statusCode,
          location: location.trim(),
          headers: res.headers,
        });
        return;
      }

      if (isAuthOrAccessChallenge(statusCode, res.headers)) {
        res.destroy();
        finishError(
          new InspectionPolicyError(
            'PROHIBITED_DESTINATION',
            'Halaman tujuan memerlukan autentikasi, otorisasi, atau membatasi akses otomatis.',
            403,
          ),
        );
        return;
      }

      const contentTypeHeader = Array.isArray(res.headers['content-type'])
        ? res.headers['content-type'][0]
        : res.headers['content-type'];

      const contentLengthRaw = Array.isArray(res.headers['content-length'])
        ? res.headers['content-length'][0]
        : res.headers['content-length'];
      const contentRangeRaw = Array.isArray(res.headers['content-range'])
        ? res.headers['content-range'][0]
        : res.headers['content-range'];
      const declaredBytes = parseTotalBytes(
        contentRangeRaw ?? null,
        statusCode === 200 ? contentLengthRaw ?? null : null,
      ) ?? undefined;

      const encodingHeader = Array.isArray(res.headers['content-encoding'])
        ? res.headers['content-encoding'][0]
        : res.headers['content-encoding'];
      const encoding = (encodingHeader ?? 'identity').trim().toLowerCase();

      let decoder: Transform | null = null;
      if (encoding === 'gzip' || encoding === 'x-gzip') {
        decoder = zlib.createGunzip();
      } else if (encoding === 'deflate') {
        decoder = zlib.createInflate();
      } else if (encoding === 'br') {
        decoder = zlib.createBrotliDecompress();
      } else if (encoding !== 'identity' && encoding !== '') {
        res.destroy();
        finishError(
          new InspectionPolicyError(
            'UNSUPPORTED_CONTENT_TYPE',
            'Format kompresi respons tidak didukung.',
            415,
          ),
        );
        return;
      }
      activeDecoder = decoder;

      const abortStreams = () => {
        if (!res.destroyed) res.destroy();
        if (decoder && !decoder.destroyed) decoder.destroy();
        if (!req.destroyed) req.destroy();
      };

      const rawLimiter = createByteLimiter(MAX_HTML_BYTES, abortStreams);
      const decodedLimiter = createByteLimiter(MAX_HTML_BYTES, abortStreams);
      const bodyChunks: Buffer[] = [];
      let sniffedChunks: Buffer[] = [];
      let sniffCollected = 0;
      let modeDecided = false;
      let isHtmlMode = false;

      const onStreamError = (err: unknown) => {
        abortStreams();
        if (err instanceof InspectionPolicyError) {
          finishError(err);
          return;
        }
        finishError(
          new InspectionPolicyError(
            'UPSTREAM_ERROR',
            'Gagal membaca respons dari situs tujuan.',
            502,
          ),
        );
      };

      const decideFromHead = (headBuf: Buffer) => {
        modeDecided = true;
        const sniffed = sniffKind(headBuf);
        const verdict = reconcile(
          contentTypeHeader ?? null,
          sniffed,
          target.normalizedUrl,
          headBuf,
        );

        if (verdict.kind === 'html') {
          isHtmlMode = true;
          if (typeof declaredBytes === 'number' && declaredBytes > MAX_HTML_BYTES) {
            abortStreams();
            finishError(
              new InspectionPolicyError(
                'RESPONSE_TOO_LARGE',
                'Ukuran halaman melebihi batas maksimum 2 MiB.',
                413,
              ),
            );
            return;
          }
          bodyChunks.push(headBuf);
          return;
        }

        if (verdict.kind === 'hls' || verdict.kind === 'dash') {
          abortStreams();
          finishSuccess({
            kind: 'asset',
            statusCode,
            contentType:
              verdict.mime ??
              (verdict.kind === 'hls'
                ? 'application/vnd.apple.mpegurl'
                : 'application/dash+xml'),
            assetKind: verdict.kind,
            declaredBytes,
            headers: res.headers,
          });
          return;
        }

        if (
          verdict.kind === 'video' ||
          verdict.kind === 'audio' ||
          verdict.kind === 'image' ||
          verdict.kind === 'pdf'
        ) {
          abortStreams();
          const mime = verdict.mime ?? parseMimeType(contentTypeHeader);
          const isSvg =
            mime === 'image/svg+xml' ||
            /\.svgz?(?:$|[?#])/i.test(target.normalizedUrl);
          finishSuccess({
            kind: 'asset',
            statusCode,
            contentType: mime || 'application/octet-stream',
            assetKind: isSvg ? 'vector' : verdict.kind,
            declaredBytes,
            headers: res.headers,
          });
          return;
        }

        if (isAllowedHtmlContentType(contentTypeHeader)) {
          isHtmlMode = true;
          bodyChunks.push(headBuf);
          return;
        }

        const inspectableMime = isDirectInspectableAssetContentType(
          contentTypeHeader,
          target.normalizedUrl,
        );
        if (inspectableMime) {
          abortStreams();
          finishSuccess({
            kind: 'asset',
            statusCode,
            contentType: inspectableMime,
            declaredBytes,
            headers: res.headers,
          });
          return;
        }

        abortStreams();
        finishError(
          new InspectionPolicyError(
            'UNSUPPORTED_CONTENT_TYPE',
            'Tujuan tidak mengembalikan halaman HTML atau berkas pratinjau yang dapat diperiksa.',
            415,
          ),
        );
      };

      const sink = new PassThrough();
      sink.on('error', onStreamError);
      res.on('error', onStreamError);
      rawLimiter.on('error', onStreamError);
      decodedLimiter.on('error', onStreamError);
      decoder?.on('error', onStreamError);

      sink.on('data', (chunk: Buffer) => {
        if (!modeDecided) {
          sniffedChunks.push(chunk);
          sniffCollected += chunk.length;
          if (sniffCollected >= SNIFF_BYTES) {
            const combined = Buffer.concat(sniffedChunks);
            sniffedChunks = [];
            decideFromHead(combined);
          }
          return;
        }
        if (isHtmlMode) {
          bodyChunks.push(chunk);
        }
      });

      sink.on('end', () => {
        if (settled) return;
        if (!modeDecided) {
          const combined = Buffer.concat(sniffedChunks);
          sniffedChunks = [];
          decideFromHead(combined);
          if (settled) return;
        }
        if (isHtmlMode) {
          const fullBuf = Buffer.concat(bodyChunks);
          const sniffed = sniffKind(fullBuf.subarray(0, SNIFF_BYTES));
          const verdict = reconcile(
            contentTypeHeader ?? null,
            sniffed,
            target.normalizedUrl,
            fullBuf,
          );
          finishSuccess({
            kind: 'document',
            statusCode,
            contentType: parseMimeType(contentTypeHeader) || 'text/html',
            bodyText: fullBuf.toString('utf8'),
            headers: res.headers,
            isWrapper: verdict.wrapper,
          });
        }
      });

      if (decoder) {
        res.pipe(rawLimiter).pipe(decoder).pipe(decodedLimiter).pipe(sink);
      } else {
        res.pipe(rawLimiter).pipe(decodedLimiter).pipe(sink);
      }
    });

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        const remoteIp = socket.remoteAddress;
        if (!remoteIp || isProhibitedIp(remoteIp)) {
          socket.destroy();
          finishError(
            new InspectionPolicyError(
              'PROHIBITED_DESTINATION',
              'Koneksi dibatalkan karena alamat tujuan tidak memenuhi kebijakan keamanan.',
              403,
            ),
          );
        }
      });
    });

    const destroyTransport = () => {
      if (activeRes && !activeRes.destroyed) activeRes.destroy();
      if (activeDecoder && !activeDecoder.destroyed) activeDecoder.destroy();
      if (!req.destroyed) req.destroy();
    };

    req.on('timeout', () => {
      destroyTransport();
      finishError(
        new InspectionPolicyError(
          'TIMEOUT',
          'Waktu koneksi ke situs tujuan habis (maksimum 8 detik).',
          408,
        ),
      );
    });

    req.on('error', (err) => {
      destroyTransport();
      if (err instanceof InspectionPolicyError) {
        finishError(err);
        return;
      }
      finishError(
        new InspectionPolicyError(
          'UPSTREAM_ERROR',
          'Tidak dapat terhubung ke situs tujuan.',
          502,
        ),
      );
    });

    const onAbort = () => {
      destroyTransport();
      finishError(
        new InspectionPolicyError('ABORTED', 'Pemeriksaan tautan dibatalkan.', 499),
      );
    };

    wallClockTimer = setTimeout(() => {
      destroyTransport();
      finishError(
        new InspectionPolicyError(
          'TIMEOUT',
          'Waktu koneksi ke situs tujuan habis (maksimum 8 detik).',
          408,
        ),
      );
    }, REQUEST_TIMEOUT_MS);

    signal?.addEventListener('abort', onAbort, { once: true });
    req.end();
  });
}
