import { useRef, useState } from 'react';
import {
  Pause,
  Play,
  Repeat,
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
  isEnded: boolean;
  isMuted: boolean;
  isLooping: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  zoom: number;
  playbackRate: number;
  durationHint: string | null;
  useDirectUrl: boolean;
  onTogglePlay: () => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onSeekTo: (time: number) => void;
  onSeekBy: (delta: number) => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onChangeVolume: (vol: number) => void;
  onApplyZoom: (zoom: number) => void;
  onResetZoom: () => void;
  onCycleSpeed: () => void;
  onPlayDirect: () => void;
}

const MOBILE_ZOOM_STEPS = [1, 1.5, 2] as const;

export function VideoPlayerControls({
  isPlaying,
  isEnded,
  isMuted,
  isLooping,
  volume,
  currentTime,
  duration,
  bufferedEnd,
  zoom,
  playbackRate,
  durationHint,
  useDirectUrl,
  onTogglePlay,
  onScrubStart,
  onScrubEnd,
  onSeekTo,
  onSeekBy,
  onToggleMute,
  onToggleLoop,
  onChangeVolume,
  onApplyZoom,
  onResetZoom,
  onCycleSpeed,
  onPlayDirect,
}: VideoPlayerControlsProps) {
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);

  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = hasFiniteDuration
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;
  const bufferedPct = hasFiniteDuration
    ? Math.min(100, Math.max(0, (bufferedEnd / duration) * 100))
    : 0;
  const hoverPct = hoverFrac !== null ? Math.min(100, Math.max(0, hoverFrac * 100)) : null;
  const hoverTime = hoverFrac !== null && hasFiniteDuration ? hoverFrac * duration : 0;

  const subtleBtnClass = 'text-white/75 hover:bg-white/10 hover:text-white';
  const outlinedBtnClass = 'border-white/15 bg-white/5 text-white/90 hover:bg-white/10';

  const cycleMobileZoom = () => {
    const idx = MOBILE_ZOOM_STEPS.findIndex((step) => Math.abs(step - zoom) < 0.05);
    const next =
      idx === -1 ? 1 : MOBILE_ZOOM_STEPS[(idx + 1) % MOBILE_ZOOM_STEPS.length];
    onApplyZoom(next);
  };

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#0d0d10]/95 pb-[env(safe-area-inset-bottom)] text-white">
      <PageContainer className="flex flex-col justify-center gap-1.5 pt-2 pb-2.5">
        {durationHint ? (
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/70">
            <span>{durationHint}</span>
            {!useDirectUrl ? (
              <button
                type="button"
                onClick={onPlayDirect}
                className="shrink-0 font-semibold text-[var(--color-amber)] hover:underline"
              >
                Putar langsung
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          ref={scrubberRef}
          onPointerMove={(e) => {
            if (!hasFiniteDuration || !scrubberRef.current) return;
            const rect = scrubberRef.current.getBoundingClientRect();
            if (rect.width <= 0) return;
            const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            setHoverFrac(frac);
          }}
          onPointerLeave={() => setHoverFrac(null)}
          className="group relative flex h-6 items-center"
        >
          {hasFiniteDuration && hoverPct !== null ? (
            <span
              aria-hidden="true"
              style={{ left: `${hoverPct}%` }}
              className="pointer-events-none absolute -top-7 z-20 -translate-x-1/2 rounded-[6px] border border-white/15 bg-[#111114]/95 px-1.5 py-0.5 text-[11px] font-medium text-white shadow-md tabular-nums"
            >
              {formatMediaTime(hoverTime)}
            </span>
          ) : null}

          <div className="pointer-events-none relative h-1.5 w-full overflow-hidden rounded-full bg-white/15 transition-[height] duration-150 group-hover:h-2">
            {hasFiniteDuration ? (
              <>
                <div
                  style={{ width: `${bufferedPct}%` }}
                  className="absolute inset-y-0 left-0 bg-white/25"
                />
                {hoverPct !== null ? (
                  <div
                    style={{ width: `${hoverPct}%` }}
                    className="absolute inset-y-0 left-0 bg-white/30"
                  />
                ) : null}
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
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-amber-strong)] opacity-100 ring-2 ring-[#0d0d10] shadow-sm transition-[opacity,transform] duration-150 sm:scale-90 sm:opacity-0 sm:group-hover:scale-105 sm:group-hover:opacity-100 sm:group-focus-within:scale-105 sm:group-focus-within:opacity-100"
            />
          ) : null}

          <input
            type="range"
            min={0}
            max={hasFiniteDuration ? duration : 1}
            step={0.05}
            disabled={!hasFiniteDuration}
            value={hasFiniteDuration ? Math.min(currentTime, duration) : 0}
            onPointerDown={onScrubStart}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
            onBlur={onScrubEnd}
            onChange={(e) => {
              if (!hasFiniteDuration) return;
              onSeekTo(Number(e.target.value));
            }}
            aria-label="Posisi durasi video"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-white/70 tabular-nums sm:hidden">
          <span>{formatMediaTime(currentTime)}</span>
          <span>{hasFiniteDuration ? formatMediaTime(duration) : '--:--'}</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 sm:gap-1.5">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Jeda video' : isEnded ? 'Putar ulang video' : 'Putar video'}
              title={isPlaying ? 'Jeda (Spasi)' : isEnded ? 'Putar ulang (Spasi)' : 'Putar (Spasi)'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
            >
              {isPlaying ? (
                <Pause size={17} aria-hidden="true" className="fill-current" />
              ) : isEnded ? (
                <RotateCcw size={17} aria-hidden="true" />
              ) : (
                <Play size={17} aria-hidden="true" className="translate-x-0.5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onSeekBy(-10)}
              aria-label="Mundur 10 detik"
              title="Mundur 10 detik (J)"
              className={`relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${subtleBtnClass}`}
            >
              <RotateCcw size={19} strokeWidth={1.85} aria-hidden="true" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold leading-none tabular-nums"
              >
                10
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSeekBy(10)}
              aria-label="Maju 10 detik"
              title="Maju 10 detik (L)"
              className={`relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${subtleBtnClass}`}
            >
              <RotateCw size={19} strokeWidth={1.85} aria-hidden="true" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold leading-none tabular-nums"
              >
                10
              </span>
            </button>

            <div className="flex items-center gap-1.5 sm:ml-0.5">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={isMuted || volume === 0 ? 'Bunyikan audio' : 'Bisukan audio'}
                title={isMuted || volume === 0 ? 'Bunyikan (M)' : 'Bisukan (M)'}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${subtleBtnClass}`}
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

            <span className="ml-1.5 hidden whitespace-nowrap text-xs text-white/70 tabular-nums sm:inline">
              {formatMediaTime(currentTime)} / {hasFiniteDuration ? formatMediaTime(duration) : '--:--'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={cycleMobileZoom}
              aria-label={`Ubah zoom video (${Math.round(zoom * 100)}%)`}
              title="Ubah tingkat zoom"
              className={`inline-flex h-9 min-w-[48px] items-center justify-center rounded-[var(--radius-sm)] border px-2 text-xs font-semibold tabular-nums transition-colors duration-150 sm:hidden ${
                zoom !== 1
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : outlinedBtnClass
              }`}
            >
              {Math.round(zoom * 100)}%
            </button>

            <div className="hidden h-9 items-center rounded-[var(--radius-sm)] border border-white/15 bg-white/5 p-0.5 sm:inline-flex">
              <button
                type="button"
                disabled={zoom <= MEDIA_MIN_ZOOM}
                onClick={() => onApplyZoom(zoom - MEDIA_ZOOM_STEP)}
                aria-label="Perkecil video"
                title="Perkecil video (-)"
                className={`inline-flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${subtleBtnClass}`}
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
                    ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                    : 'text-white hover:bg-white/10'
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
                className={`inline-flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${subtleBtnClass}`}
              >
                <ZoomIn size={15} aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={isLooping}
              aria-label={isLooping ? 'Matikan ulangi otomatis' : 'Aktifkan ulangi otomatis'}
              title={isLooping ? 'Ulangi otomatis aktif' : 'Ulangi otomatis'}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border transition-colors duration-150 ${
                isLooping
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : outlinedBtnClass
              }`}
            >
              <Repeat size={15} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onCycleSpeed}
              aria-label={`Kecepatan putar ${playbackRate}x`}
              title="Ubah kecepatan putar"
              className={`inline-flex h-9 min-w-[42px] items-center justify-center rounded-[var(--radius-sm)] border px-2 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                playbackRate !== 1
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : outlinedBtnClass
              }`}
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
