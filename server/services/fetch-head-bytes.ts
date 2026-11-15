import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Readable, Transform } from 'node:stream';
import {
  SNIFF_BYTES,
  SNIFF_TIMEOUT_MS,
  type HeaderMode,
} from '../config/limits.ts';
import { isProhibitedIp } from '../security/ip-policy.ts';
import {
  InspectionPolicyError,
  type DnsLookupFn,
} from '../types/server.ts';
import { buildHeaders } from './http-headers.ts';
import {
  defaultDnsLookup,
  resolveAndValidateUrl,
  type ValidatedTarget,
} from './url-policy.ts';

export interface HeadBytesResult {
  status: number;
  location: string | null;
  declaredType: string | null;
  declaredBytes: number | null;
  acceptRanges: boolean;
  headers: http.IncomingHttpHeaders;
  buf: Buffer;
}

export interface FetchHeadOptions {
  dnsLookup?: DnsLookupFn;
  signal?: AbortSignal;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function headerValue(
  headers: http.IncomingHttpHeaders,
  name: string,
): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** `bytes 0-2047/146681790` → 146681790. `Content-Length` hanya dipakai untuk 200 penuh. */
export function parseTotalBytes(
  contentRange: string | null,
  contentLength: string | null,
): number | null {
  if (contentRange) {
    const total = /\/(\d+)\s*$/.exec(contentRange);
    if (total) {
      const n = Number(total[1]);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
  }
  if (contentLength) {
    const n = Number(contentLength);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function makePinnedLookup(target: ValidatedTarget): https.RequestOptions['lookup'] {
  return (_hostname, options, callback) => {
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
  };
}

export async function fetchHeadBytes(
  targetOrUrl: string | ValidatedTarget,
  pageUrl: string | null,
  mode: HeaderMode,
  options: FetchHeadOptions = {},
): Promise<HeadBytesResult> {
  const target =
    typeof targetOrUrl === 'string'
      ? await resolveAndValidateUrl(targetOrUrl, options.dnsLookup)
      : targetOrUrl;

  const timeoutMs = options.timeoutMs ?? SNIFF_TIMEOUT_MS;
  const headers: Record<string, string> = {
    ...buildHeaders(target.normalizedUrl, pageUrl, mode),
    ...options.extraHeaders,
    Host: target.url.host,
    Range: `bytes=0-${SNIFF_BYTES - 1}`,
  };

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new InspectionPolicyError('ABORTED', 'Permintaan dibatalkan.', 499));
      return;
    }

    const isHttps = target.url.protocol === 'https:';
    const transport = isHttps ? https : http;
    let settled = false;
    let activeRes: http.IncomingMessage | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      options.signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (activeRes && !activeRes.destroyed) activeRes.destroy();
      if (!req.destroyed) req.destroy();
      reject(err);
    };

    const succeed = (result: HeadBytesResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (activeRes && !activeRes.destroyed) activeRes.destroy();
      if (!req.destroyed) req.destroy();
      resolve(result);
    };

    const req = transport.request(
      {
        method: 'GET',
        agent: false,
        hostname: target.hostname,
        port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
        path: `${target.url.pathname}${target.url.search}`,
        servername:
          isHttps && net.isIP(target.hostname) === 0
            ? target.hostname
            : undefined,
        rejectUnauthorized: true,
        timeout: timeoutMs,
        headers,
        lookup: makePinnedLookup(target),
      },
      (res) => {
        activeRes = res;
        const status = res.statusCode ?? 0;
        const location = headerValue(res.headers, 'location');
        const declaredType = headerValue(res.headers, 'content-type');
        const declaredBytes = parseTotalBytes(
          headerValue(res.headers, 'content-range'),
          status === 200 ? headerValue(res.headers, 'content-length') : null,
        );
        const acceptRanges =
          status === 206 ||
          /bytes/i.test(headerValue(res.headers, 'accept-ranges') ?? '');

        if (status >= 300 && status < 400) {
          res.resume();
          succeed({
            status,
            location,
            declaredType,
            declaredBytes,
            acceptRanges,
            headers: res.headers,
            buf: Buffer.alloc(0),
          });
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        res.on('data', (raw: Buffer | Uint8Array) => {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          const remain = SNIFF_BYTES - total;
          if (remain <= 0) return;
          if (chunk.length >= remain) {
            chunks.push(chunk.subarray(0, remain));
            total += remain;
            succeed({
              status,
              location,
              declaredType,
              declaredBytes,
              acceptRanges,
              headers: res.headers,
              buf: Buffer.concat(chunks, total),
            });
            return;
          }
          chunks.push(chunk);
          total += chunk.length;
        });

        res.on('end', () => {
          succeed({
            status,
            location,
            declaredType,
            declaredBytes,
            acceptRanges,
            headers: res.headers,
            buf: Buffer.concat(chunks, total),
          });
        });

        res.on('error', (err) => {
          if (settled) return;
          fail(
            err instanceof InspectionPolicyError
              ? err
              : new InspectionPolicyError('UPSTREAM_ERROR', 'Gagal membaca header byte.', 502),
          );
        });
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
              'Koneksi dibatalkan karena alamat tujuan terlarang.',
              403,
            ),
          );
        }
      });
    });

    req.on('timeout', () => {
      fail(new InspectionPolicyError('TIMEOUT', 'Waktu permintaan habis.', 408));
    });

    req.on('error', (err) => {
      fail(
        err instanceof InspectionPolicyError
          ? err
          : new InspectionPolicyError('UPSTREAM_ERROR', 'Gagal terhubung ke host tujuan.', 502),
      );
    });

    const onAbort = () => {
      fail(new InspectionPolicyError('ABORTED', 'Permintaan dibatalkan.', 499));
    };

    timer = setTimeout(() => {
      fail(new InspectionPolicyError('TIMEOUT', 'Waktu sniffing byte habis.', 408));
    }, timeoutMs);

    options.signal?.addEventListener('abort', onAbort, { once: true });
    req.end();
  });
}

export interface PinnedStreamResponse {
  status: number;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  stream: Readable;
  abort: () => void;
}

export async function openPinnedStream(
  rawUrl: string,
  pageUrl: string | null,
  mode: HeaderMode,
  options: {
    dnsLookup?: DnsLookupFn;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRedirects?: number;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<PinnedStreamResponse> {
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? SNIFF_TIMEOUT_MS;
  let currentUrl = rawUrl;
  const visited = new Set<string>([rawUrl]);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = await resolveAndValidateUrl(currentUrl, dnsLookup);
    const headers: Record<string, string> = {
      ...buildHeaders(target.normalizedUrl, pageUrl, mode),
      ...options.extraHeaders,
      Host: target.url.host,
    };

    const res = await new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      stream: http.IncomingMessage;
      abort: () => void;
    }>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new InspectionPolicyError('ABORTED', 'Permintaan dibatalkan.', 499));
        return;
      }

      const isHttps = target.url.protocol === 'https:';
      const transport = isHttps ? https : http;
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;

      const clearConnectTimer = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearConnectTimer();
        options.signal?.removeEventListener('abort', onAbort);
        if (!req.destroyed) req.destroy();
        reject(err);
      };

      const req = transport.request(
        {
          method: 'GET',
          agent: false,
          hostname: target.hostname,
          port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
          path: `${target.url.pathname}${target.url.search}`,
          servername:
            isHttps && net.isIP(target.hostname) === 0
              ? target.hostname
              : undefined,
          rejectUnauthorized: true,
          timeout: timeoutMs,
          headers,
          lookup: makePinnedLookup(target),
        },
        (incoming) => {
          if (settled) {
            incoming.destroy();
            return;
          }
          settled = true;
          clearConnectTimer();
          options.signal?.removeEventListener('abort', onAbort);
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            stream: incoming,
            abort: () => {
              if (!incoming.destroyed) incoming.destroy();
              if (!req.destroyed) req.destroy();
            },
          });
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
                'Alamat tujuan melanggar kebijakan jaringan.',
                403,
              ),
            );
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        fail(new InspectionPolicyError('TIMEOUT', 'Waktu koneksi ke host asal habis.', 408));
      });

      req.on('error', (err) => {
        fail(
          err instanceof InspectionPolicyError
            ? err
            : new InspectionPolicyError('UPSTREAM_ERROR', 'Gagal terhubung ke host tujuan.', 502),
        );
      });

      const onAbort = () => {
        req.destroy();
        fail(new InspectionPolicyError('ABORTED', 'Permintaan dibatalkan.', 499));
      };

      connectTimer = setTimeout(() => {
        req.destroy();
        fail(new InspectionPolicyError('TIMEOUT', 'Waktu tunggu respons awal habis.', 408));
      }, timeoutMs);

      options.signal?.addEventListener('abort', onAbort, { once: true });
      req.end();
    });

    if (REDIRECT_STATUS.has(res.status) && hop < maxRedirects) {
      const loc = headerValue(res.headers, 'location');
      res.stream.resume();
      if (!loc?.trim()) {
        throw new InspectionPolicyError('INVALID_REDIRECT', 'Header Location kosong.', 502);
      }
      const nextUrl = new URL(loc.trim(), target.normalizedUrl).href;
      if (visited.has(nextUrl)) {
        throw new InspectionPolicyError('REDIRECT_LOOP', 'Terjadi pengalihan berulang.', 422);
      }
      visited.add(nextUrl);
      currentUrl = nextUrl;
      continue;
    }

    return {
      status: res.status,
      finalUrl: target.normalizedUrl,
      headers: res.headers,
      stream: res.stream,
      abort: res.abort,
    };
  }

  throw new InspectionPolicyError('TOO_MANY_REDIRECTS', 'Pengalihan melebihi batas.', 422);
}

export async function fetchHtmlBodyWithProfile(
  url: string,
  pageUrl: string | null,
  mode: HeaderMode,
  options: FetchHeadOptions & { maxBytes?: number } = {},
): Promise<{ status: number; finalUrl: string; html: string; headers: http.IncomingHttpHeaders }> {
  const maxBytes = options.maxBytes ?? 3_000_000;
  const opened = await openPinnedStream(url, pageUrl, mode, {
    dnsLookup: options.dnsLookup,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxRedirects: 3,
    extraHeaders: {
      'Accept-Encoding': 'gzip, deflate, br',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const encHeader = headerValue(opened.headers, 'content-encoding') ?? 'identity';
  const enc = encHeader.trim().toLowerCase();
  let decoder: Transform | null = null;
  if (enc === 'gzip' || enc === 'x-gzip') decoder = zlib.createGunzip();
  else if (enc === 'deflate') decoder = zlib.createInflate();
  else if (enc === 'br') decoder = zlib.createBrotliDecompress();

  const source: Readable = decoder ? opened.stream.pipe(decoder) : opened.stream;
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const raw of source) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const remain = maxBytes - total;
      if (remain <= 0) break;
      chunks.push(chunk.length > remain ? chunk.subarray(0, remain) : chunk);
      total += Math.min(chunk.length, remain);
      if (total >= maxBytes) {
        opened.abort();
        break;
      }
    }
  } finally {
    decoder?.destroy();
  }

  return {
    status: opened.status,
    finalUrl: opened.finalUrl,
    headers: opened.headers,
    html: Buffer.concat(chunks, total).toString('utf8'),
  };
}
