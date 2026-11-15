import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Transform } from 'node:stream';
import { isProhibitedIp } from '../security/ip-policy.ts';
import { parseMimeType } from '../security/request-limits.ts';
import type { DnsLookupFn } from '../types/server.ts';
import { defaultDnsLookup, resolveAndValidateUrl } from './url-policy.ts';

export const FILTER_FETCH_TIMEOUT_MS = 10_000;
export const MAX_FILTER_BYTES = 8 * 1024 * 1024; // 8 MiB bound for raw & decoded lists
export const MAX_FILTER_REDIRECTS = 3;

export interface RemoteFilterSourceSpec {
  id: string;
  name: string;
  purpose: string;
  sourceUrl: string;
  allowedOrigins: string[];
  attribution: string;
  license: string;
  syntaxScope: string;
  expectedSha256?: string;
}

export const OFFICIAL_REMOTE_FILTER_SOURCES: RemoteFilterSourceSpec[] = [
  {
    id: 'easylist-official',
    name: 'EasyList (Resmi)',
    purpose: 'Daftar jaringan domain & jalur iklan web umum',
    sourceUrl: 'https://easylist.to/easylist/easylist.txt',
    allowedOrigins: ['https://easylist.to'],
    attribution: 'The EasyList authors (https://easylist.to/)',
    license: 'CC BY-SA 3.0 / GPLv3',
    syntaxScope:
      'Hanya mengevaluasi aturan jaringan yang didukung (||domain^, @@||domain^, jalur statis, $third-party). Aturan kosmetik (##), regex, dan skrip dilewati secara aman.',
  },
  {
    id: 'easyprivacy-official',
    name: 'EasyPrivacy (Resmi)',
    purpose: 'Daftar jaringan domain & jalur pelacak analitik pihak ketiga',
    sourceUrl: 'https://easylist.to/easylist/easyprivacy.txt',
    allowedOrigins: ['https://easylist.to'],
    attribution: 'The EasyList authors (https://easylist.to/)',
    license: 'CC BY-SA 3.0 / GPLv3',
    syntaxScope:
      'Hanya mengevaluasi aturan jaringan yang didukung. Tidak melakukan pemblokiran aktif di dalam iframe lintas-asal.',
  },
  {
    id: 'peter-lowe-adlist',
    name: "Peter Lowe's Ad & Tracking Server List",
    purpose: 'Daftar host server iklan dan pelacak berformat Adblock domain-anchor',
    sourceUrl:
      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
    allowedOrigins: ['https://pgl.yoyo.org'],
    attribution: 'Peter Lowe (https://pgl.yoyo.org/adservers/)',
    license: 'Gratis untuk penggunaan pemblokiran dengan atribusi sumber',
    syntaxScope: 'Aturan domain (||domain^). Diperbarui berkala oleh pengelola.',
  },
];

export type SourceFetchResult =
  | {
      kind: 'not-modified';
      etag?: string;
      lastModified?: string;
    }
  | {
      kind: 'ok';
      text: string;
      etag?: string;
      lastModified?: string;
      contentType: string;
    };

export type FetchFilterSourceFn = (
  spec: RemoteFilterSourceSpec,
  conditional: { etag?: string; lastModified?: string },
) => Promise<SourceFetchResult>;

export class SourceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

function createFilterByteLimiter(maxBytes: number, onLimit: () => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        onLimit();
        callback(
          new SourceFetchError('Ukuran berkas daftar filter melebihi batas maksimum 8 MiB.'),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

function isOriginAllowed(url: URL, allowedOrigins: string[]): boolean {
  if (url.protocol !== 'https:') return false;
  return allowedOrigins.includes(url.origin);
}

async function fetchSingleHttpsHop(
  targetUrl: URL,
  allowedOrigins: string[],
  headersToSend: Record<string, string>,
  dnsLookup: DnsLookupFn,
): Promise<
  | { kind: 'redirect'; location: string }
  | { kind: 'not-modified'; etag?: string; lastModified?: string }
  | { kind: 'ok'; text: string; etag?: string; lastModified?: string; contentType: string }
> {
  if (!isOriginAllowed(targetUrl, allowedOrigins)) {
    throw new SourceFetchError('Origin sumber daftar filter tidak berada dalam daftar izin HTTPS.');
  }

  const validated = await resolveAndValidateUrl(targetUrl.toString(), dnsLookup).catch(() => {
    throw new SourceFetchError(
      'Alamat tujuan sumber daftar filter ditolak oleh kebijakan SSRF/DNS.',
    );
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (
      val:
        | { kind: 'redirect'; location: string }
        | { kind: 'not-modified'; etag?: string; lastModified?: string }
        | { kind: 'ok'; text: string; etag?: string; lastModified?: string; contentType: string },
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const req = https.request(
      {
        method: 'GET',
        agent: false,
        hostname: validated.hostname,
        port: validated.url.port ? Number(validated.url.port) : 443,
        path: `${validated.url.pathname}${validated.url.search}`,
        servername:
          net.isIP(validated.hostname) === 0 ? validated.hostname : undefined,
        rejectUnauthorized: true,
        timeout: FILTER_FETCH_TIMEOUT_MS,
        headers: {
          Host: validated.url.host,
          'User-Agent': 'CDNFREE-FilterSync/0.1 (+https://cdnfree.invalid)',
          Accept: 'text/plain;q=1.0, */*;q=0.1',
          'Accept-Encoding': 'gzip, deflate, br',
          ...headersToSend,
        },
        lookup: (_hostname, options, callback) => {
          if (options && typeof options === 'object' && options.all) {
            callback(null, [
              {
                address: validated.pinnedAddress.address,
                family: validated.pinnedAddress.family,
              },
            ]);
            return;
          }
          callback(
            null,
            validated.pinnedAddress.address,
            validated.pinnedAddress.family,
          );
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const rawLoc = res.headers.location;
          const location = Array.isArray(rawLoc) ? rawLoc[0] : rawLoc;
          res.resume();
          if (!location?.trim()) {
            fail(new SourceFetchError('Server sumber mengirim pengalihan tanpa lokasi valid.'));
            return;
          }
          succeed({ kind: 'redirect', location: location.trim() });
          return;
        }

        const etag = typeof res.headers.etag === 'string' ? res.headers.etag : undefined;
        const lastModified =
          typeof res.headers['last-modified'] === 'string'
            ? res.headers['last-modified']
            : undefined;

        if (statusCode === 304) {
          res.resume();
          succeed({ kind: 'not-modified', etag, lastModified });
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.destroy();
          fail(
            new SourceFetchError(
              `Server sumber mengembalikan status HTTP ${statusCode}.`,
            ),
          );
          return;
        }

        const rawCt = Array.isArray(res.headers['content-type'])
          ? res.headers['content-type'][0]
          : res.headers['content-type'];
        const contentType = parseMimeType(rawCt);
        if (!contentType.startsWith('text/plain')) {
          res.destroy();
          fail(
            new SourceFetchError(
              'Format Content-Type sumber bukan text/plain yang diharapkan.',
            ),
          );
          return;
        }

        const rawCl = res.headers['content-length'];
        if (rawCl) {
          const declared = Number(Array.isArray(rawCl) ? rawCl[0] : rawCl);
          if (Number.isFinite(declared) && declared > MAX_FILTER_BYTES) {
            res.destroy();
            fail(
              new SourceFetchError(
                'Ukuran berkas daftar filter melebihi batas maksimum 8 MiB.',
              ),
            );
            return;
          }
        }

        const encHeader = Array.isArray(res.headers['content-encoding'])
          ? res.headers['content-encoding'][0]
          : res.headers['content-encoding'];
        const encoding = (encHeader ?? 'identity').trim().toLowerCase();
        let decoder: Transform | null = null;
        if (encoding === 'gzip' || encoding === 'x-gzip') {
          decoder = zlib.createGunzip();
        } else if (encoding === 'deflate') {
          decoder = zlib.createInflate();
        } else if (encoding === 'br') {
          decoder = zlib.createBrotliDecompress();
        } else if (encoding !== 'identity' && encoding !== '') {
          res.destroy();
          fail(new SourceFetchError('Format kompresi sumber tidak didukung.'));
          return;
        }

        const abortAll = () => {
          res.destroy();
          decoder?.destroy();
          req.destroy();
        };

        const rawLimiter = createFilterByteLimiter(MAX_FILTER_BYTES, abortAll);
        const decodedLimiter = createFilterByteLimiter(MAX_FILTER_BYTES, abortAll);
        const chunks: Buffer[] = [];

        const onStreamErr = (err: unknown) => {
          abortAll();
          fail(
            err instanceof SourceFetchError
              ? err
              : new SourceFetchError('Gagal membaca aliran daftar filter dari sumber.'),
          );
        };

        res.on('error', onStreamErr);
        rawLimiter.on('error', onStreamErr);
        decodedLimiter.on('error', onStreamErr);
        decoder?.on('error', onStreamErr);
        decodedLimiter.on('data', (c: Buffer) => chunks.push(c));
        decodedLimiter.on('end', () => {
          succeed({
            kind: 'ok',
            text: Buffer.concat(chunks).toString('utf8'),
            etag,
            lastModified,
            contentType,
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
        const ip = socket.remoteAddress;
        if (!ip || isProhibitedIp(ip)) {
          socket.destroy();
          fail(
            new SourceFetchError('Koneksi ke alamat privat/terlarang diblokir kebijakan SSRF.'),
          );
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      fail(new SourceFetchError('Waktu koneksi pembaruan daftar filter habis.'));
    });

    req.on('error', (err) => {
      fail(
        err instanceof SourceFetchError
          ? err
          : new SourceFetchError('Tidak dapat terhubung ke server sumber daftar filter.'),
      );
    });

    timer = setTimeout(() => {
      req.destroy();
      fail(new SourceFetchError('Batas waktu pembaruan daftar filter terlampaui (10 detik).'));
    }, FILTER_FETCH_TIMEOUT_MS);

    req.end();
  });
}

export async function safeFetchFilterSource(
  spec: RemoteFilterSourceSpec,
  conditional: { etag?: string; lastModified?: string },
  dnsLookup: DnsLookupFn = defaultDnsLookup,
): Promise<SourceFetchResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(spec.sourceUrl);
  } catch {
    throw new SourceFetchError('URL sumber daftar filter tidak valid.');
  }

  const conditionalHeaders: Record<string, string> = {};
  if (conditional.etag) {
    conditionalHeaders['If-None-Match'] = conditional.etag;
  }
  if (conditional.lastModified) {
    conditionalHeaders['If-Modified-Since'] = conditional.lastModified;
  }

  const visited = new Set<string>([currentUrl.toString()]);

  for (let hop = 0; hop <= MAX_FILTER_REDIRECTS; hop += 1) {
    const res = await fetchSingleHttpsHop(
      currentUrl,
      spec.allowedOrigins,
      hop === 0 ? conditionalHeaders : {},
      dnsLookup,
    );

    if (res.kind !== 'redirect') {
      return res;
    }

    if (hop >= MAX_FILTER_REDIRECTS) {
      throw new SourceFetchError('Terlalu banyak pengalihan pada sumber daftar filter.');
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(res.location, currentUrl);
    } catch {
      throw new SourceFetchError('Alamat pengalihan sumber daftar filter tidak valid.');
    }

    if (visited.has(nextUrl.toString())) {
      throw new SourceFetchError('Terdeteksi loop pengalihan pada sumber daftar filter.');
    }
    visited.add(nextUrl.toString());
    currentUrl = nextUrl;
  }

  throw new SourceFetchError('Pembaruan daftar filter tidak dapat diselesaikan.');
}
