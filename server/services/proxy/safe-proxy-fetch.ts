import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { isProhibitedIp } from '../../security/ip-policy.ts';
import { MAX_REDIRECT_HOPS, PROXY_LIMITS } from '../../security/request-limits.ts';
import { InspectionPolicyError, type DnsLookupFn } from '../../types/server.ts';
import {
  defaultDnsLookup,
  resolveAndValidateUrl,
  type ValidatedTarget,
} from '../url-policy.ts';

export const PROXY_TIMEOUT_MS = 20_000;
export const STREAM_PROXY_TIMEOUT_MS = 60_000;
export const MAX_PROXY_BODY_BYTES = PROXY_LIMITS.html;

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface SafeProxyFetchResult {
  finalUrl: string;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: Buffer;
  stream?: Readable;
  cleanup?: () => void;
}

export interface SafeProxyFetchOptions {
  method?: 'GET' | 'HEAD';
  range?: string;
  headers?: Record<string, string>;
  stream?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  dnsLookup?: DnsLookupFn;
  signal?: AbortSignal;
}

function createByteLimiter(maxBytes: number, onExceed: () => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        onExceed();
        callback(
          new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran respons situs tujuan melebihi batas maksimum proxy.',
            413,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

function fetchSingleProxyHop(
  target: ValidatedTarget,
  options: {
    method: 'GET' | 'HEAD';
    range?: string;
    extraHeaders?: Record<string, string>;
    stream: boolean;
    maxBytes: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<
  | { kind: 'redirect'; location: string; statusCode: number }
  | {
      kind: 'response';
      statusCode: number;
      headers: http.IncomingHttpHeaders;
      body?: Buffer;
      stream?: Readable;
      cleanup?: () => void;
    }
> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new InspectionPolicyError('ABORTED', 'Permintaan proxy dibatalkan.', 499));
      return;
    }

    const isHttps = target.url.protocol === 'https:';
    const transport = isHttps ? https : http;
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout> | null = null;

    const clearWallTimer = () => {
      if (wallTimer) {
        clearTimeout(wallTimer);
        wallTimer = null;
      }
    };

    const cleanupListeners = () => {
      clearWallTimer();
      options.signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      reject(err);
    };

    const succeed = (
      val:
        | { kind: 'redirect'; location: string; statusCode: number }
        | {
            kind: 'response';
            statusCode: number;
            headers: http.IncomingHttpHeaders;
            body?: Buffer;
            stream?: Readable;
            cleanup?: () => void;
          },
    ) => {
      if (settled) return;
      settled = true;
      if (val.kind === 'response' && val.stream) {
        clearWallTimer();
      } else {
        cleanupListeners();
      }
      resolve(val);
    };

    const useIdentityEncoding =
      options.stream || options.method === 'HEAD' || Boolean(options.range);

    const headers: Record<string, string> = {
      Host: target.url.host,
      'User-Agent': BROWSER_USER_AGENT,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': useIdentityEncoding ? 'identity' : 'gzip, deflate, br',
      ...(options.extraHeaders ?? {}),
    };
    if (options.range && !headers.Range && !headers.range) {
      headers.Range = options.range;
    }

    const req = transport.request(
      {
        method: options.method,
        agent: false,
        hostname: target.hostname,
        port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
        path: `${target.url.pathname}${target.url.search}`,
        servername:
          isHttps && net.isIP(target.hostname) === 0 ? target.hostname : undefined,
        rejectUnauthorized: true,
        timeout: options.timeoutMs,
        headers,
        lookup: (_hostname, lookupOpts, callback) => {
          if (lookupOpts && typeof lookupOpts === 'object' && lookupOpts.all) {
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
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        if (REDIRECT_CODES.has(statusCode)) {
          const rawLoc = res.headers.location;
          const loc = Array.isArray(rawLoc) ? rawLoc[0] : rawLoc;
          res.resume();

          if (!loc || !loc.trim()) {
            fail(
              new InspectionPolicyError(
                'INVALID_REDIRECT',
                'Server tujuan mengirim pengalihan tanpa alamat tujuan.',
                502,
              ),
            );
            return;
          }

          succeed({ kind: 'redirect', location: loc.trim(), statusCode });
          return;
        }

        if (options.method === 'HEAD') {
          res.resume();
          succeed({
            kind: 'response',
            statusCode,
            headers: res.headers,
            body: Buffer.alloc(0),
          });
          return;
        }

        if (options.stream) {
          const teardownStream = () => {
            options.signal?.removeEventListener('abort', onAbort);
            if (!res.destroyed) res.destroy();
            if (!req.destroyed) req.destroy();
          };
          res.once('end', () => {
            options.signal?.removeEventListener('abort', onAbort);
          });
          res.once('close', () => {
            options.signal?.removeEventListener('abort', onAbort);
          });
          succeed({
            kind: 'response',
            statusCode,
            headers: res.headers,
            stream: res,
            cleanup: teardownStream,
          });
          return;
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
        }

        const abortStreams = () => {
          res.destroy();
          decoder?.destroy();
          req.destroy();
        };

        const rawLimiter = createByteLimiter(options.maxBytes, abortStreams);
        const decodedLimiter = createByteLimiter(options.maxBytes, abortStreams);
        const chunks: Buffer[] = [];

        const onStreamErr = (err: unknown) => {
          abortStreams();
          if (err instanceof InspectionPolicyError) {
            fail(err);
            return;
          }
          fail(
            new InspectionPolicyError(
              'UPSTREAM_ERROR',
              'Gagal membaca respons dari situs tujuan.',
              502,
            ),
          );
        };

        res.on('error', onStreamErr);
        rawLimiter.on('error', onStreamErr);
        decodedLimiter.on('error', onStreamErr);
        decoder?.on('error', onStreamErr);

        decodedLimiter.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        decodedLimiter.on('end', () => {
          succeed({
            kind: 'response',
            statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });

        if (decoder) {
          res.pipe(rawLimiter).pipe(decoder).pipe(decodedLimiter);
        } else {
          res.pipe(rawLimiter).pipe(decodedLimiter);
        }
      },
    );

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        const remoteIp = socket.remoteAddress;
        if (!remoteIp || isProhibitedIp(remoteIp)) {
          socket.destroy();
          fail(
            new InspectionPolicyError(
              'PROHIBITED_DESTINATION',
              'Koneksi dibatalkan karena alamat tujuan tidak diizinkan kebijakan keamanan.',
              403,
            ),
          );
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      fail(
        new InspectionPolicyError(
          'TIMEOUT',
          'Waktu koneksi ke situs tujuan habis.',
          408,
        ),
      );
    });

    req.on('error', (err) => {
      if (err instanceof InspectionPolicyError) {
        fail(err);
        return;
      }
      fail(
        new InspectionPolicyError(
          'UPSTREAM_ERROR',
          'Tidak dapat terhubung ke situs tujuan.',
          502,
        ),
      );
    });

    const onAbort = () => {
      req.destroy();
      fail(new InspectionPolicyError('ABORTED', 'Permintaan dibatalkan.', 499));
    };

    wallTimer = setTimeout(() => {
      req.destroy();
      fail(
        new InspectionPolicyError(
          'TIMEOUT',
          'Waktu koneksi ke situs tujuan habis.',
          408,
        ),
      );
    }, options.timeoutMs);

    options.signal?.addEventListener('abort', onAbort, { once: true });
    req.end();
  });
}

export async function safeProxyFetch(
  rawUrl: string,
  options: SafeProxyFetchOptions = {},
): Promise<SafeProxyFetchResult> {
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const isStream = options.stream === true;
  const method = options.method ?? 'GET';
  const maxBytes = options.maxBytes ?? MAX_PROXY_BODY_BYTES;
  const timeoutMs =
    options.timeoutMs ?? (isStream ? STREAM_PROXY_TIMEOUT_MS : PROXY_TIMEOUT_MS);

  let current = await resolveAndValidateUrl(rawUrl, dnsLookup);
  const visited = new Set<string>([current.normalizedUrl.split('#')[0]]);

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const outcome = await fetchSingleProxyHop(current, {
      method,
      range: options.range ?? options.headers?.range ?? options.headers?.Range,
      extraHeaders: options.headers,
      stream: isStream,
      maxBytes,
      timeoutMs,
      signal: options.signal,
    });

    if (outcome.kind === 'redirect') {
      if (hop >= MAX_REDIRECT_HOPS) {
        throw new InspectionPolicyError(
          'TOO_MANY_REDIRECTS',
          `Pengalihan situs tujuan melebihi batas maksimum ${MAX_REDIRECT_HOPS} langkah.`,
          422,
        );
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(outcome.location, current.normalizedUrl);
      } catch {
        throw new InspectionPolicyError(
          'INVALID_REDIRECT',
          'Alamat pengalihan dari situs tujuan tidak valid.',
          502,
        );
      }

      const nextTarget = await resolveAndValidateUrl(nextUrl.toString(), dnsLookup);
      const nextHashless = nextTarget.normalizedUrl.split('#')[0];
      if (visited.has(nextHashless)) {
        throw new InspectionPolicyError(
          'REDIRECT_LOOP',
          'Terdeteksi pengalihan berulang pada situs tujuan.',
          422,
        );
      }
      visited.add(nextHashless);
      current = nextTarget;
      continue;
    }

    return {
      finalUrl: current.normalizedUrl,
      statusCode: outcome.statusCode,
      headers: outcome.headers,
      body: outcome.body,
      stream: outcome.stream,
      cleanup: outcome.cleanup,
    };
  }

  throw new InspectionPolicyError(
    'TOO_MANY_REDIRECTS',
    `Pengalihan situs tujuan melebihi batas maksimum ${MAX_REDIRECT_HOPS} langkah.`,
    422,
  );
}
