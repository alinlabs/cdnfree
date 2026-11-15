import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  HEADER_LADDER,
  HLS_MAX_SEGMENTS,
  HLS_SEGMENT_CONCURRENCY,
  MAX_MEDIA_BYTES,
  RETRYABLE_STATUS,
} from '../config/limits.ts';
import { InspectionPolicyError, type DnsLookupFn } from '../types/server.ts';
import { openPinnedStream } from './fetch-head-bytes.ts';
import { getProfile, recordFailure, recordSuccess } from './header-profile-store.ts';
import { buildPlaylistContext, listSegments } from './hls-playlist.ts';
import { defaultDnsLookup } from './url-policy.ts';

export interface HlsDownloadResult {
  contentType: string;
  contentLength?: number;
  filenameExt: 'mp4' | 'ts';
  stream: Readable;
  abort: () => void;
}

export interface HlsDownloadOptions {
  sid: string;
  assetId: string;
  playlistUrl: string;
  referer?: string | null;
  dnsLookup?: DnsLookupFn;
  maxBytes?: number;
  signal?: AbortSignal;
}

let ffmpegAvailablePromise: Promise<boolean> | null = null;

function checkFfmpegAvailable(): Promise<boolean> {
  if (!ffmpegAvailablePromise) {
    ffmpegAvailablePromise = new Promise<boolean>((resolve) => {
      const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }
  return ffmpegAvailablePromise;
}

async function fetchPinnedBuffer(
  url: string,
  pageUrl: string | null,
  dnsLookup: DnsLookupFn,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ status: number; finalUrl: string; buf: Buffer }> {
  const host = new URL(url).hostname;
  const learned = getProfile(host);
  const modes = learned
    ? [learned.mode, ...HEADER_LADDER.filter((m) => m !== learned.mode)]
    : [...HEADER_LADDER];

  let lastStatus = 502;
  for (const mode of modes) {
    const opened = await openPinnedStream(url, pageUrl, mode, {
      dnsLookup,
      signal,
      maxRedirects: 4,
    });

    if (RETRYABLE_STATUS.has(opened.status)) {
      lastStatus = opened.status;
      opened.abort();
      if (learned?.mode === mode) recordFailure(host);
      continue;
    }

    if (opened.status < 200 || opened.status >= 300) {
      lastStatus = opened.status;
      opened.abort();
      throw new InspectionPolicyError(
        'UPSTREAM_ERROR',
        `Segmen atau playlist HLS gagal diambil (HTTP ${opened.status}).`,
        opened.status === 404 ? 404 : 502,
      );
    }

    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const raw of opened.stream) {
        if (signal?.aborted) {
          opened.abort();
          throw new InspectionPolicyError('ABORTED', 'Unduhan HLS dibatalkan.', 499);
        }
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        total += chunk.length;
        if (total > maxBytes) {
          opened.abort();
          throw new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran unduhan HLS melebihi batas maksimum server.',
            413,
          );
        }
        chunks.push(chunk);
      }
    } finally {
      opened.abort();
    }

    let origin: string | null = null;
    if (pageUrl) {
      try {
        origin = new URL(pageUrl).origin;
      } catch {
        origin = null;
      }
    }
    recordSuccess(host, mode, pageUrl, origin);
    return {
      status: opened.status,
      finalUrl: opened.finalUrl,
      buf: Buffer.concat(chunks, total),
    };
  }

  throw new InspectionPolicyError(
    lastStatus === 403 || lastStatus === 401 ? 'PROHIBITED_DESTINATION' : 'UPSTREAM_ERROR',
    `Server HLS menolak akses (HTTP ${lastStatus}).`,
    lastStatus === 403 || lastStatus === 401 ? 403 : 502,
  );
}

async function remuxWithFfmpeg(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath],
      { stdio: 'ignore' },
    );

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 60_000);

    const onAbort = () => {
      child.kill('SIGKILL');
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(code === 0);
    });
  });
}

export async function downloadHlsToStream(
  options: HlsDownloadOptions,
): Promise<HlsDownloadResult> {
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const maxBytes = options.maxBytes ?? MAX_MEDIA_BYTES;
  const pageUrl = options.referer ?? null;

  let currentPlaylistUrl = options.playlistUrl;
  let playlistBody = '';
  let rootCtx = buildPlaylistContext(options.sid, options.assetId, currentPlaylistUrl, currentPlaylistUrl);

  for (let depth = 0; depth < 3; depth += 1) {
    const fetched = await fetchPinnedBuffer(
      currentPlaylistUrl,
      pageUrl,
      dnsLookup,
      Math.min(maxBytes, 8 * 1024 * 1024),
      options.signal,
    );
    playlistBody = fetched.buf.toString('utf8');
    rootCtx = buildPlaylistContext(
      options.sid,
      options.assetId,
      fetched.finalUrl,
      depth === 0 ? fetched.finalUrl : options.playlistUrl,
    );
    const parsed = listSegments(playlistBody, rootCtx);
    if (!parsed.isMaster) break;
    const topVariant = parsed.variants[0];
    if (!topVariant) break;
    currentPlaylistUrl = topVariant.url;
  }

  const parsed = listSegments(playlistBody, rootCtx);
  const allUrls = [...parsed.initSegments, ...parsed.segments];
  if (allUrls.length === 0) {
    throw new InspectionPolicyError(
      'UPSTREAM_ERROR',
      'Playlist HLS tidak memuat segmen media yang dapat diunduh.',
      502,
    );
  }
  if (allUrls.length > HLS_MAX_SEGMENTS) {
    throw new InspectionPolicyError(
      'RESPONSE_TOO_LARGE',
      `Jumlah segmen HLS (${allUrls.length}) melebihi batas maksimum (${HLS_MAX_SEGMENTS}).`,
      413,
    );
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cdnfree-hls-'));
  let cleanupStarted = false;
  const cleanupDir = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    void fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    let totalBytes = 0;
    let nextIdx = 0;
    const partPaths = new Array<string>(allUrls.length);

    const worker = async () => {
      while (true) {
        if (options.signal?.aborted) {
          throw new InspectionPolicyError('ABORTED', 'Unduhan HLS dibatalkan.', 499);
        }
        const idx = nextIdx;
        nextIdx += 1;
        if (idx >= allUrls.length) break;

        const segUrl = allUrls[idx];
        const remaining = maxBytes - totalBytes;
        if (remaining <= 0) {
          throw new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran unduhan HLS melebihi batas maksimum server.',
            413,
          );
        }
        const seg = await fetchPinnedBuffer(
          segUrl,
          pageUrl,
          dnsLookup,
          remaining,
          options.signal,
        );
        totalBytes += seg.buf.length;
        if (totalBytes > maxBytes) {
          throw new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran unduhan HLS melebihi batas maksimum server.',
            413,
          );
        }
        const partPath = path.join(tmpDir, `seg-${String(idx).padStart(5, '0')}.part`);
        await fsp.writeFile(partPath, seg.buf);
        partPaths[idx] = partPath;
      }
    };

    const workers = Array.from(
      { length: Math.min(HLS_SEGMENT_CONCURRENCY, allUrls.length) },
      () => worker(),
    );
    await Promise.all(workers);

    const rawJoinedPath = path.join(tmpDir, 'joined.ts');
    const writeStream = fs.createWriteStream(rawJoinedPath);
    for (const partPath of partPaths) {
      const buf = await fsp.readFile(partPath);
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buf, (err) => (err ? reject(err) : resolve()));
      });
      await fsp.unlink(partPath).catch(() => {});
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    let finalPath = rawJoinedPath;
    let contentType = 'video/mp2t';
    let filenameExt: 'mp4' | 'ts' = 'ts';

    if (await checkFfmpegAvailable()) {
      const mp4Path = path.join(tmpDir, 'output.mp4');
      const remuxed = await remuxWithFfmpeg(rawJoinedPath, mp4Path, options.signal);
      if (remuxed) {
        finalPath = mp4Path;
        contentType = 'video/mp4';
        filenameExt = 'mp4';
        await fsp.unlink(rawJoinedPath).catch(() => {});
      }
    }

    const stat = await fsp.stat(finalPath);
    const readStream = fs.createReadStream(finalPath);
    readStream.once('close', cleanupDir);
    readStream.once('error', cleanupDir);

    return {
      contentType,
      contentLength: stat.size,
      filenameExt,
      stream: readStream,
      abort: () => {
        if (!readStream.destroyed) readStream.destroy();
        cleanupDir();
      },
    };
  } catch (err) {
    cleanupDir();
    throw err;
  }
}
