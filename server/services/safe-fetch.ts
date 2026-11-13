import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Transform } from 'node:stream';
import { isProhibitedIp } from '../security/ip-policy.ts';
import {
  MAX_HTML_BYTES,
  REQUEST_TIMEOUT_MS,
  isAllowedHtmlContentType,
  isDirectInspectableAssetContentType,
  parseMimeType,
} from '../security/request-limits.ts';
import { InspectionPolicyError } from '../types/server.ts';
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
    }
  | {
      kind: 'asset';
      statusCode: number;
      contentType: string;
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
      agent: false, // Never reuse sockets across requests or hops
      hostname: target.hostname,
      port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
      path: `${target.url.pathname}${target.url.search}`,
      servername:
        isHttps && net.isIP(target.hostname) === 0 ? target.hostname : undefined,
      rejectUnauthorized: true,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Host: target.url.host,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      // Pin socket connection strictly to the already-validated IP
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

      if (!isAllowedHtmlContentType(contentTypeHeader)) {
        const inspectableMime = isDirectInspectableAssetContentType(
          contentTypeHeader,
          target.normalizedUrl,
        );
        if (inspectableMime) {
          const lengthHeader = Array.isArray(res.headers['content-length'])
            ? res.headers['content-length'][0]
            : res.headers['content-length'];
          const parsedLength = lengthHeader ? Number(lengthHeader) : undefined;
          res.destroy();
          finishSuccess({
            kind: 'asset',
            statusCode,
            contentType: inspectableMime,
            declaredBytes:
              typeof parsedLength === 'number' &&
              Number.isFinite(parsedLength) &&
              parsedLength >= 0
                ? parsedLength
                : undefined,
            headers: res.headers,
          });
          return;
        }

        res.destroy();
        finishError(
          new InspectionPolicyError(
            'UNSUPPORTED_CONTENT_TYPE',
            'Tujuan tidak mengembalikan halaman HTML atau berkas pratinjau yang dapat diperiksa.',
            415,
          ),
        );
        return;
      }

      const contentLengthHeader = res.headers['content-length'];
      if (contentLengthHeader) {
        const declared = Number(
          Array.isArray(contentLengthHeader)
            ? contentLengthHeader[0]
            : contentLengthHeader,
        );
        if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
          res.destroy();
          finishError(
            new InspectionPolicyError(
              'RESPONSE_TOO_LARGE',
              'Ukuran halaman melebihi batas maksimum 2 MiB.',
              413,
            ),
          );
          return;
        }
      }

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

      const abortStreams = () => {
        res.destroy();
        decoder?.destroy();
        req.destroy();
      };

      const rawLimiter = createByteLimiter(MAX_HTML_BYTES, abortStreams);
      const decodedLimiter = createByteLimiter(MAX_HTML_BYTES, abortStreams);
      const chunks: Buffer[] = [];

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

      res.on('error', onStreamError);
      rawLimiter.on('error', onStreamError);
      decodedLimiter.on('error', onStreamError);
      decoder?.on('error', onStreamError);

      decodedLimiter.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      decodedLimiter.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        finishSuccess({
          kind: 'document',
          statusCode,
          contentType: parseMimeType(contentTypeHeader),
          bodyText,
          headers: res.headers,
        });
      });

      if (decoder) {
        res.pipe(rawLimiter).pipe(decoder).pipe(decodedLimiter);
      } else {
        res.pipe(rawLimiter).pipe(decodedLimiter);
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

    req.on('timeout', () => {
      req.destroy();
      finishError(
        new InspectionPolicyError(
          'TIMEOUT',
          'Waktu koneksi ke situs tujuan habis (maksimum 8 detik).',
          408,
        ),
      );
    });

    req.on('error', (err) => {
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
      req.destroy();
      finishError(
        new InspectionPolicyError('ABORTED', 'Pemeriksaan tautan dibatalkan.', 499),
      );
    };

    wallClockTimer = setTimeout(() => {
      req.destroy();
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
