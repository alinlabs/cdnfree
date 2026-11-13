import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { PageContainer } from '../../../components/page-container';
import {
  formatMediaTime,
  MEDIA_MAX_ZOOM,
  MEDIA_MIN_ZOOM,
  MEDIA_ZOOM_STEP,
} from './media-player-utils';

interface VideoPlayerControlsProps {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  zoom: number;
  playbackRate: number;
  isFullscreen: boolean;
  durationHint: string | null;
  useDirectUrl: boolean;
  onTogglePlay: () => void;
  onSeekTo: (time: number) => void;
  onSeekBy: (delta: number) => void;
  onToggleMute: () => void;
  onChangeVolume: (vol: number) => void;
  onApplyZoom: (zoom: number) => void;
  onResetZoom: () => void;
  onCycleSpeed: () => void;
  onToggleFullscreen: () => void;
  onPlayDirect: () => void;
}

export function VideoPlayerControls({
  isPlaying,
  isMuted,
  volume,
  currentTime,
  duration,
  bufferedEnd,
  zoom,
  playbackRate,
  isFullscreen,
  durationHint,
  useDirectUrl,
  onTogglePlay,
  onSeekTo,
  onSeekBy,
  onToggleMute,
  onChangeVolume,
  onApplyZoom,
  onResetZoom,
  onCycleSpeed,
  onToggleFullscreen,
  onPlayDirect,
}: VideoPlayerControlsProps) {
  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = hasFiniteDuration ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPct = hasFiniteDuration ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg)] pb-[env(safe-area-inset-bottom)]">
      <PageContainer className="flex min-h-[72px] flex-col justify-center gap-1.5 pt-1.5 pb-2">
        {durationHint ? (
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>{durationHint}</span>
            {!useDirectUrl ? (
              <button
                type="button"
                onClick={onPlayDirect}
                className="shrink-0 font-semibold text-[var(--color-amber-strong)] hover:underline"
              >
                Putar langsung
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="group relative flex h-3.5 items-center">
          <div className="pointer-events-none relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-subtle)] transition-[height] duration-150 group-hover:h-2">
            {hasFiniteDuration ? (
              <>
                <div
                  style={{ width: `${bufferedPct}%` }}
                  className="absolute inset-y-0 left-0 bg-[var(--color-border)]"
                />
                <div
                  style={{ width: `${progressPct}%` }}
                  className="absolute inset-y-0 left-0 bg-[var(--color-amber)]"
                />
              </>
            ) : (
              <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-[var(--color-amber)]/60" />
            )}
          </div>
          {hasFiniteDuration ? (
            <span
              aria-hidden="true"
              style={{ left: `${progressPct}%` }}
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-amber-strong)] opacity-0 ring-2 ring-[var(--color-surface)] shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            />
          ) : null}
          <input
            type="range"
            min={0}
            max={hasFiniteDuration ? duration : 1}
            step={0.1}
            disabled={!hasFiniteDuration}
            value={hasFiniteDuration ? Math.min(currentTime, duration) : 0}
            onChange={(e) => {
              if (!hasFiniteDuration) return;
              onSeekTo(Number(e.target.value));
            }}
            aria-label="Posisi durasi video"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:flex-nowrap">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Jeda video' : 'Putar video'}
              title={isPlaying ? 'Jeda (Spasi)' : 'Putar (Spasi)'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
            >
              {isPlaying ? (
                <Pause size={17} aria-hidden="true" className="fill-current" />
              ) : (
                <Play size={17} aria-hidden="true" className="translate-x-0.5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onSeekBy(-10)}
              aria-label="Mundur 10 detik"
              title="Mundur 10 detik (J)"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onSeekBy(10)}
              aria-label="Maju 10 detik"
              title="Maju 10 detik (L)"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            >
              <RotateCw size={16} aria-hidden="true" />
            </button>

            <div className="ml-0.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={isMuted || volume === 0 ? 'Bunyikan audio' : 'Bisukan audio'}
                title={isMuted || volume === 0 ? 'Bunyikan (M)' : 'Bisukan (M)'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX size={17} aria-hidden="true" />
                ) : (
                  <Volume2 size={17} aria-hidden="true" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => onChangeVolume(Number(e.target.value))}
                aria-label="Volume audio"
                className="hidden h-1 w-20 cursor-pointer accent-[var(--color-amber)] md:block"
              />
            </div>

            <span className="ml-1.5 whitespace-nowrap text-xs text-[var(--color-text-muted)] tabular-nums">
              {formatMediaTime(currentTime)} / {hasFiniteDuration ? formatMediaTime(duration) : '--:--'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-0.5">
              <button
                type="button"
                disabled={zoom <= MEDIA_MIN_ZOOM}
                onClick={() => onApplyZoom(zoom - MEDIA_ZOOM_STEP)}
                aria-label="Perkecil video"
                title="Perkecil video (-)"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomOut size={15} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onResetZoom}
                aria-label="Reset zoom video"
                title="Reset zoom ke 100% (0)"
                className={`inline-flex h-8 min-w-[50px] items-center justify-center rounded-[6px] px-1.5 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                  zoom !== 1
                    ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                }`}
              >
                {Math.round(zoom * 100)}%
              </button>

              <button
                type="button"
                disabled={zoom >= MEDIA_MAX_ZOOM}
                onClick={() => onApplyZoom(zoom + MEDIA_ZOOM_STEP)}
                aria-label="Perbesar video"
                title="Perbesar video (+)"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomIn size={15} aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={onCycleSpeed}
              aria-label={`Kecepatan putar ${playbackRate}x`}
              title="Ubah kecepatan putar"
              className="inline-flex h-9 min-w-[44px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-semibold text-[var(--color-text)] tabular-nums transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              {playbackRate}x
            </button>

            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
              title={isFullscreen ? 'Keluar layar penuh (F)' : 'Layar penuh (F)'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            >
              {isFullscreen ? (
                <Minimize size={16} aria-hidden="true" />
              ) : (
                <Maximize size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
