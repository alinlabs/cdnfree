import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Readable } from 'node:stream';
import { isProhibitedIp } from '../security/ip-policy.ts';
import {
  ASSET_DOWNLOAD_TIMEOUT_MS,
  MAX_ASSET_DOWNLOAD_BYTES,
  MAX_REDIRECT_HOPS,
  isSafeDownloadContentType,
  parseMimeType,
  sanitizeDownloadFilename,
} from '../security/request-limits.ts';
import {
  InspectionPolicyError,
  type DnsLookupFn,
  type ResourceRecord,
} from '../types/server.ts';
import type { InspectionStore } from './inspection-store.ts';
import {
  defaultDnsLookup,
  resolveAndValidateUrl,
  type ValidatedTarget,
} from './url-policy.ts';

export type AssetHopOutcome =
  | {
      kind: 'redirect';
      statusCode: number;
      location: string;
    }
  | {
      kind: 'stream';
      statusCode: number;
      contentType: string;
      contentLength?: number;
      stream: Readable;
      abort: () => void;
    };

export type FetchAssetHopFn = (
  target: ValidatedTarget,
  maxBytes: number,
  signal?: AbortSignal,
) => Promise<AssetHopOutcome>;

export interface PreparedAssetDownload {
  filename: string;
  contentType: string;
  contentLength?: number;
  maxBytes: number;
  stream: Readable;
  abort: () => void;
}

export interface PrepareAssetDownloadOptions {
  store: InspectionStore;
  inspectionId: string;
  resourceId: string;
  dnsLookup?: DnsLookupFn;
  fetchAssetHop?: FetchAssetHopFn;
  maxBytes?: number;
  signal?: AbortSignal;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export function validateResourceDownloadEligibility(resource: ResourceRecord): void {
  if (resource.observation === 'blocked') {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Aset tidak dapat diunduh karena ditandai diblokir oleh kebijakan inspeksi.',
      403,
    );
  }

  if (resource.classification === 'known-malicious') {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Aset tidak dapat diunduh karena cocok dengan indikator berisiko tinggi.',
      403,
    );
  }

  if (resource.classification === 'ad-or-tracker') {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Aset tidak dapat diunduh karena cocok dengan aturan daftar filter iklan atau pelacak.',
      403,
    );
  }

  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const isPdf =
    mime === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(resource.url);

  if ((resource.kind === 'document' && !isPdf) || resource.kind === 'script') {
    throw new InspectionPolicyError(
      'UNSUPPORTED_CONTENT_TYPE',
      'Aset bertipe halaman HTML atau skrip tidak tersedia untuk pengunduhan langsung.',
      403,
    );
  }
}

export function safeFetchAssetHop(
  target: ValidatedTarget,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<AssetHopOutcome> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new InspectionPolicyError('ABORTED', 'Unduhan aset dibatalkan.', 499));
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

    const finishSuccess = (outcome: AssetHopOutcome) => {
      if (settled) return;
      settled = true;
      clearWallTimer();
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
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
        timeout: ASSET_DOWNLOAD_TIMEOUT_MS,
        headers: {
          Host: target.url.host,
          'User-Agent': 'CDNFREE-AssetFetcher/0.1 (+https://cdnfree.invalid)',
          Accept: 'image/*,video/*,audio/*,font/*,text/css;q=0.9,*/*;q=0.1',
          'Accept-Encoding': 'identity',
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
      },
      (res) => {
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
                'Aset tidak dapat diunduh karena pengalihan tidak menyertakan alamat tujuan.',
                502,
              ),
            );
            return;
          }

          finishSuccess({
            kind: 'redirect',
            statusCode,
            location: location.trim(),
          });
          return;
        }

        const hasAuthChallenge = Boolean(res.headers['www-authenticate']);
        if (statusCode === 401 || statusCode === 402 || statusCode === 403 || hasAuthChallenge) {
          res.destroy();
          finishError(
            new InspectionPolicyError(
              'PROHIBITED_DESTINATION',
              'Aset tidak dapat diunduh karena memerlukan autentikasi, otorisasi, atau tidak tersedia secara publik.',
              403,
            ),
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.destroy();
          finishError(
            new InspectionPolicyError(
              'UPSTREAM_ERROR',
              `Aset tidak dapat diunduh karena server asal mengembalikan status HTTP ${statusCode}.`,
              statusCode === 404 ? 404 : 502,
            ),
          );
          return;
        }

        const contentTypeHeader = Array.isArray(res.headers['content-type'])
          ? res.headers['content-type'][0]
          : res.headers['content-type'];

        if (!isSafeDownloadContentType(contentTypeHeader)) {
          res.destroy();
          finishError(
            new InspectionPolicyError(
              'UNSUPPORTED_CONTENT_TYPE',
              'Aset tidak dapat diunduh karena tipe file tidak didukung atau berpotensi dieksekusi.',
              415,
            ),
          );
          return;
        }

        const contentLengthHeader = res.headers['content-length'];
        let declaredLength: number | undefined;
        if (contentLengthHeader) {
          const parsedLength = Number(
            Array.isArray(contentLengthHeader)
              ? contentLengthHeader[0]
              : contentLengthHeader,
          );
          if (Number.isFinite(parsedLength) && parsedLength >= 0) {
            declaredLength = parsedLength;
            if (parsedLength > maxBytes) {
              res.destroy();
              finishError(
                new InspectionPolicyError(
                  'RESPONSE_TOO_LARGE',
                  'Aset tidak dapat diunduh karena ukurannya melebihi batas maksimum server.',
                  413,
                ),
              );
              return;
            }
          }
        }

        finishSuccess({
          kind: 'stream',
          statusCode,
          contentType: parseMimeType(contentTypeHeader),
          contentLength: declaredLength,
          stream: res,
          abort: () => {
            res.destroy();
            req.destroy();
          },
        });
      },
    );

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        const remoteIp = socket.remoteAddress;
        if (!remoteIp || isProhibitedIp(remoteIp)) {
          socket.destroy();
          finishError(
            new InspectionPolicyError(
              'PROHIBITED_DESTINATION',
              'Aset tidak dapat diunduh karena alamat tujuan melanggar kebijakan jaringan.',
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
          'Waktu unduhan aset habis sebelum selesai.',
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
          'Aset tidak dapat diunduh karena gagal terhubung ke host asal.',
          502,
        ),
      );
    });

    const onAbort = () => {
      req.destroy();
      finishError(new InspectionPolicyError('ABORTED', 'Unduhan aset dibatalkan.', 499));
    };

    wallClockTimer = setTimeout(() => {
      req.destroy();
      finishError(
        new InspectionPolicyError(
          'TIMEOUT',
          'Waktu koneksi ke aset tujuan habis sebelum selesai.',
          408,
        ),
      );
    }, ASSET_DOWNLOAD_TIMEOUT_MS);

    signal?.addEventListener('abort', onAbort, { once: true });
    req.end();
  });
}

export async function prepareAssetDownload(
  options: PrepareAssetDownloadOptions,
): Promise<PreparedAssetDownload> {
  const inspection = options.store.get(options.inspectionId);
  if (!inspection) {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'Aset tidak dapat diunduh karena sesi inspeksi tidak ditemukan atau sudah kedaluwarsa. Periksa ulang URL terlebih dahulu.',
      404,
    );
  }

  const resource = inspection.resources.find((item) => item.id === options.resourceId);
  if (!resource) {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'Aset tidak ditemukan pada hasil inspeksi ini.',
      404,
    );
  }

  validateResourceDownloadEligibility(resource);

  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const fetchAssetHop = options.fetchAssetHop ?? safeFetchAssetHop;
  const maxBytes = options.maxBytes ?? MAX_ASSET_DOWNLOAD_BYTES;

  let currentTarget = await resolveAndValidateUrl(resource.url, dnsLookup);
  const initialLoopUrl = new URL(currentTarget.normalizedUrl);
  initialLoopUrl.hash = '';
  const visitedUrls = new Set<string>([initialLoopUrl.toString()]);

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const outcome = await fetchAssetHop(currentTarget, maxBytes, options.signal);

    if (outcome.kind === 'redirect') {
      if (hop >= MAX_REDIRECT_HOPS) {
        throw new InspectionPolicyError(
          'TOO_MANY_REDIRECTS',
          'Aset tidak dapat diunduh karena rantai pengalihan terlalu panjang.',
          422,
        );
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(outcome.location, currentTarget.normalizedUrl);
      } catch {
        throw new InspectionPolicyError(
          'INVALID_REDIRECT',
          'Aset tidak dapat diunduh karena alamat pengalihan tidak valid.',
          502,
        );
      }

      const nextLoopUrl = new URL(nextUrl.toString());
      nextLoopUrl.hash = '';
      const nextUrlStr = nextUrl.toString();
      if (visitedUrls.has(nextLoopUrl.toString())) {
        throw new InspectionPolicyError(
          'REDIRECT_LOOP',
          'Aset tidak dapat diunduh karena terjadi pengalihan berulang.',
          422,
        );
      }

      currentTarget = await resolveAndValidateUrl(nextUrlStr, dnsLookup);
      const canonicalLoopUrl = new URL(currentTarget.normalizedUrl);
      canonicalLoopUrl.hash = '';
      visitedUrls.add(canonicalLoopUrl.toString());
      continue;
    }

    if (!isSafeDownloadContentType(outcome.contentType)) {
      outcome.abort();
      throw new InspectionPolicyError(
        'UNSUPPORTED_CONTENT_TYPE',
        'Aset tidak dapat diunduh karena tipe file tidak didukung atau berpotensi dieksekusi.',
        415,
      );
    }

    if (
      typeof outcome.contentLength === 'number' &&
      outcome.contentLength > maxBytes
    ) {
      outcome.abort();
      throw new InspectionPolicyError(
        'RESPONSE_TOO_LARGE',
        'Aset tidak dapat diunduh karena ukurannya melebihi batas maksimum server.',
        413,
      );
    }

    const filename = sanitizeDownloadFilename(
      currentTarget.normalizedUrl,
      outcome.contentType,
      resource.id,
    );

    return {
      filename,
      contentType: outcome.contentType,
      contentLength: outcome.contentLength,
      maxBytes,
      stream: outcome.stream,
      abort: outcome.abort,
    };
  }

  throw new InspectionPolicyError(
    'TOO_MANY_REDIRECTS',
    'Aset tidak dapat diunduh karena rantai pengalihan melebihi batas.',
    422,
  );
}
