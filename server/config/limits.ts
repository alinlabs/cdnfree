function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const SNIFF_BYTES = readPositiveIntEnv('SNIFF_BYTES', 2048);
export const SNIFF_TIMEOUT_MS = readPositiveIntEnv('SNIFF_TIMEOUT_MS', 12_000);
export const HOP_BUDGET_MS = 15_000;
export const MAX_REDIRECT_HOPS = 8;
export const MAX_PROBE_DEPTH = 2;
export const MAX_FRAMES = 8;
export const MAX_PLAYLISTS = 3;

/** Batas unduhan tunggal untuk media (2 GiB). */
export const MAX_MEDIA_BYTES = readPositiveIntEnv(
  'MAX_MEDIA_BYTES',
  2 * 1024 * 1024 * 1024,
);
/** Batas untuk non-media (dokumen/gambar) tetap ketat (25 MiB). */
export const MAX_SMALL_BYTES = 25 * 1024 * 1024;

export const HLS_SEGMENT_CONCURRENCY = 4;
export const HLS_MAX_SEGMENTS = 4000;
export const HLS_REMINT_WINDOW_SEC = 60;

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const HEADER_LADDER = ['page-origin', 'none', 'host-root'] as const;
export type HeaderMode = (typeof HEADER_LADDER)[number];

export const RETRYABLE_STATUS = new Set([401, 403, 406, 429, 451, 503]);
