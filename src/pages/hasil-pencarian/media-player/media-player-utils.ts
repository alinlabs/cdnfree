import { formatBytes } from '../../../utils/format-bytes';

export const PLAYBACK_SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;

export const MEDIA_MIN_ZOOM = 0.5;
export const MEDIA_MAX_ZOOM = 4;
export const MEDIA_ZOOM_STEP = 0.25;
export const MEDIA_WHEEL_ZOOM_STEP = 0.2;

export interface MediaPanOffset {
  x: number;
  y: number;
}

export function clampMediaZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const clamped = Math.min(MEDIA_MAX_ZOOM, Math.max(MEDIA_MIN_ZOOM, zoom));
  return Number(clamped.toFixed(2));
}

export function stepMediaZoom(current: number, delta: number): number {
  return clampMediaZoom(current + delta);
}

export function clampMediaPan(
  pan: MediaPanOffset,
  zoom: number,
  bounds: { width: number; height: number },
): MediaPanOffset {
  if (!Number.isFinite(zoom) || zoom <= 1) {
    return { x: 0, y: 0 };
  }
  if (bounds.width <= 0 || bounds.height <= 0) {
    return pan;
  }
  const maxX = Math.max(0, ((zoom - 1) * bounds.width) / 2);
  const maxY = Math.max(0, ((zoom - 1) * bounds.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

export function clampMediaIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), total - 1);
}

export function getPrevMediaIndex(index: number, total: number): number {
  if (total <= 1) return 0;
  const safe = clampMediaIndex(index, total);
  return (safe - 1 + total) % total;
}

export function getNextMediaIndex(index: number, total: number): number {
  if (total <= 1) return 0;
  const safe = clampMediaIndex(index, total);
  return (safe + 1) % total;
}

export function getNextPlaybackSpeed(current: number): number {
  const idx = PLAYBACK_SPEED_OPTIONS.indexOf(
    current as (typeof PLAYBACK_SPEED_OPTIONS)[number],
  );
  if (idx === -1) return 1;
  return PLAYBACK_SPEED_OPTIONS[(idx + 1) % PLAYBACK_SPEED_OPTIONS.length];
}

export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export interface MediaSubtitleMetaInput {
  host: string;
  formatLabel: string;
  declaredBytes?: number;
  index: number;
  total: number;
  statusMessage?: string;
}

export function buildMediaSubtitleMeta({
  host,
  formatLabel,
  declaredBytes,
  index,
  total,
  statusMessage,
}: MediaSubtitleMetaInput): string {
  const parts: string[] = [host, formatLabel, formatBytes(declaredBytes)];
  if (total > 1) {
    parts.push(`${clampMediaIndex(index, total) + 1} / ${total}`);
  }
  if (statusMessage) {
    parts.push(statusMessage);
  }
  return parts.join(' · ');
}

export type VideoPlaybackFailureKind = 'network' | 'decode' | 'src' | 'unknown';

export function mapVideoMediaError(errorCode?: number | null): VideoPlaybackFailureKind {
  if (errorCode === 2) return 'network';
  if (errorCode === 3) return 'decode';
  if (errorCode === 4) return 'src';
  return 'unknown';
}

export function getVideoErrorCopy(
  kind: VideoPlaybackFailureKind,
  mimeType?: string,
  isDirectFallback = false,
): { title: string; description: string } {
  if (kind === 'network') {
    return {
      title: 'Koneksi ke sumber terputus',
      description: isDirectFallback
        ? 'Koneksi langsung ke server video terputus saat memuat data. Anda dapat mencoba ulang atau mengunduh berkas.'
        : 'Koneksi ke sumber terputus saat melakukan streaming melalui proxy. Anda dapat mencoba ulang, memutar langsung dari sumber, atau mengunduh berkas.',
    };
  }
  if (kind === 'decode') {
    return {
      title: 'Dekode video gagal di browser',
      description: `Browser gagal mendekode aliran media (${mimeType ?? 'video'}). Codec di dalam berkas mungkin tidak didukung perangkat ini, tetapi aset tetap dapat diunduh.`,
    };
  }
  if (kind === 'src') {
    return {
      title: isDirectFallback
        ? 'Sumber media tidak didukung browser'
        : 'Sumber media tidak dapat diputar via proxy',
      description: isDirectFallback
        ? `Format media (${mimeType ?? 'video'}) ditolak atau tidak didukung oleh pemutar HTML5 browser ini. Anda tetap dapat mengunduh atau menyalin tautan aset.`
        : `Pemutar tidak menerima aliran via proxy (${mimeType ?? 'video'}). Coba tombol "Putar langsung" untuk memuat langsung dari server asal, atau unduh berkas.`,
    };
  }
  return {
    title: 'Video gagal dimuat di browser',
    description: `Terjadi kendala saat memuat media (${mimeType ?? 'video'}). Anda dapat mencoba memutar langsung dari sumber atau mengunduh berkas.`,
  };
}

