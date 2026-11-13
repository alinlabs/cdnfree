import type { Request, Response as ExpressResponse } from 'express';
import { Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';
import { InspectionPolicyError } from '../../types/server.ts';

const EXTENSION_TYPE_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  aac: 'audio/aac',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  pdf: 'application/pdf',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  json: 'application/json',
  m3u8: 'application/vnd.apple.mpegurl',
};

export function guessMimeTypeFromUrl(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const dot = pathname.lastIndexOf('.');
    const slash = pathname.lastIndexOf('/');
    if (dot > slash && dot !== -1) {
      const ext = pathname.slice(dot + 1);
      if (EXTENSION_TYPE_MAP[ext]) {
        return EXTENSION_TYPE_MAP[ext];
      }
    }
  } catch {
    // Ignore malformed URLs
  }
  return 'application/octet-stream';
}

export type ParsedSingleRange =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: 'invalid' | 'multi-range' | 'unsatisfiable' };

export function parseSingleRange(
  rangeHeader: string,
  totalLength: number,
): ParsedSingleRange {
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return { ok: false, reason: 'invalid' };
  }

  const trimmed = rangeHeader.trim();
  if (!/^bytes=/i.test(trimmed)) {
    return { ok: false, reason: 'invalid' };
  }

  const spec = trimmed.slice(6).trim();
  if (!spec || spec.includes(',')) {
    return { ok: false, reason: spec.includes(',') ? 'multi-range' : 'invalid' };
  }

  const dashIndex = spec.indexOf('-');
  if (dashIndex === -1) {
    return { ok: false, reason: 'invalid' };
  }

  const rawStart = spec.slice(0, dashIndex).trim();
  const rawEnd = spec.slice(dashIndex + 1).trim();

  let start: number;
  let end: number;

  if (rawStart === '') {
    if (!/^\d+$/.test(rawEnd)) return { ok: false, reason: 'invalid' };
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return { ok: false, reason: 'unsatisfiable' };
    }
    start = Math.max(0, totalLength - suffix);
    end = totalLength - 1;
  } else {
    if (!/^\d+$/.test(rawStart)) return { ok: false, reason: 'invalid' };
    start = Number(rawStart);
    if (rawEnd === '') {
      end = totalLength - 1;
    } else {
      if (!/^\d+$/.test(rawEnd)) return { ok: false, reason: 'invalid' };
      end = Math.min(Number(rawEnd), totalLength - 1);
    }
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= totalLength ||
    start > end
  ) {
    return { ok: false, reason: 'unsatisfiable' };
  }

  return { ok: true, start, end };
}

export function createByteRangeSliceStream(
  start: number,
  end: number,
  onReachedEnd?: () => void,
): Transform {
  let offset = 0;
  let finished = false;
  const maxOffset = end + 1;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (finished) {
        callback();
        return;
      }

      const chunkStart = offset;
      const chunkEnd = offset + chunk.length;
      offset = chunkEnd;

      if (chunkEnd <= start) {
        callback();
        return;
      }

      const sliceFrom = Math.max(0, start - chunkStart);
      const sliceTo = Math.min(chunk.length, maxOffset - chunkStart);
      if (sliceTo > sliceFrom) {
        this.push(chunk.subarray(sliceFrom, sliceTo));
      }

      if (chunkEnd >= maxOffset) {
        finished = true;
        this.push(null);
        onReachedEnd?.();
      }

      callback();
    },
  });
}

function toNodeReadable(upstream: globalThis.Response | Readable): Readable | null {
  if (upstream instanceof Readable) {
    return upstream;
  }
  if (!upstream.body) {
    return null;
  }
  return Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
}

export function pipeUpstream(
  upstream: globalThis.Response | Readable,
  res: ExpressResponse,
  req: Request,
  cleanupUpstream?: () => void,
): void {
  const node = toNodeReadable(upstream);
  if (!node) {
    res.end();
    return;
  }

  let closed = false;
  const teardown = () => {
    if (closed) return;
    closed = true;
    node.destroy();
    cleanupUpstream?.();
  };

  node.on('error', () => {
    teardown();
    if (!res.destroyed) {
      res.destroy();
    }
  });

  req.on('close', () => {
    if (!res.writableEnded) {
      teardown();
    }
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      teardown();
    }
  });

  res.flushHeaders?.();
  node.pipe(res);
}

export async function readStreamWithLimit(
  source: Readable,
  maxBytes: number,
  contentEncoding?: string,
): Promise<Buffer> {
  const encoding = (contentEncoding ?? 'identity').trim().toLowerCase();
  let decoder: Transform | null = null;
  if (encoding === 'gzip' || encoding === 'x-gzip') {
    decoder = zlib.createGunzip();
  } else if (encoding === 'deflate') {
    decoder = zlib.createInflate();
  } else if (encoding === 'br') {
    decoder = zlib.createBrotliDecompress();
  }

  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let rawBytes = 0;
    let decodedBytes = 0;
    const chunks: Buffer[] = [];

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      source.destroy();
      decoder?.destroy();
      reject(err);
    };

    const exceedError = () =>
      new InspectionPolicyError(
        'RESPONSE_TOO_LARGE',
        'Ukuran respons situs tujuan melebihi batas maksimum proxy.',
        413,
      );

    source.on('error', () => {
      fail(
        new InspectionPolicyError(
          'UPSTREAM_ERROR',
          'Gagal membaca respons dari situs tujuan.',
          502,
        ),
      );
    });

    if (decoder) {
      source.on('data', (chunk: Buffer) => {
        rawBytes += chunk.length;
        if (rawBytes > maxBytes) {
          fail(exceedError());
        }
      });

      decoder.on('error', () => {
        fail(
          new InspectionPolicyError(
            'UPSTREAM_ERROR',
            'Gagal mendekode respons dari situs tujuan.',
            502,
          ),
        );
      });

      decoder.on('data', (chunk: Buffer) => {
        decodedBytes += chunk.length;
        if (decodedBytes > maxBytes) {
          fail(exceedError());
          return;
        }
        chunks.push(chunk);
      });

      decoder.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });

      source.pipe(decoder);
      return;
    }

    source.on('data', (chunk: Buffer) => {
      rawBytes += chunk.length;
      if (rawBytes > maxBytes) {
        fail(exceedError());
        return;
      }
      chunks.push(chunk);
    });

    source.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}
