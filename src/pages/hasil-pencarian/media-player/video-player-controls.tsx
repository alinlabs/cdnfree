import { useRef, useState } from 'react';
import {
  FastForward,
  FlipHorizontal2,
  FlipVertical2,
  Pause,
  Play,
  Repeat,
  Rewind,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
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
import { VideoSpeedControl } from './video-speed-control';
import { VideoVolumeControl } from './video-volume-control';

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
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  playbackRate: number;
  durationHint: string | null;
  totalItems: number;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onSeekTo: (time: number) => void;
  onSeekBy: (deltaSeconds: number) => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onChangeVolume: (vol: number) => void;
  onApplyZoom: (zoom: number) => void;
  onResetZoom: () => void;
  onRotate: () => void;
  onToggleFlipX: () => void;
  onToggleFlipY: () => void;
  onChangeSpeed: (speed: number) => void;
  onSpeedMenuOpenChange?: (open: boolean) => void;
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
  rotation,
  flipX,
  flipY,
  playbackRate,
  durationHint,
  totalItems,
  onPrev,
  onNext,
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
  onRotate,
  onToggleFlipX,
  onToggleFlipY,
  onChangeSpeed,
  onSpeedMenuOpenChange,
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

  const cycleMobileZoom = () => {
    const idx = MOBILE_ZOOM_STEPS.findIndex((step) => Math.abs(step - zoom) < 0.05);
    const next =
      idx === -1 ? 1 : MOBILE_ZOOM_STEPS[(idx + 1) % MOBILE_ZOOM_STEPS.length];
    onApplyZoom(next);
  };

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#0d0d10]/90 pb-[env(safe-area-inset-bottom)] text-white backdrop-blur-sm">
      <PageContainer className="flex flex-col justify-center gap-1.5 pt-2 pb-2.5">
        {durationHint ? (
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/70">
            <span>{durationHint}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2.5 sm:gap-3">
          <span className="shrink-0 text-[11px] font-medium text-white/85 tabular-nums sm:text-xs">
            {formatMediaTime(currentTime)}
          </span>

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
            className="group relative flex h-6 min-w-0 flex-1 items-center"
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
              onPointerUp={(e) => {
                if (e.pointerType === 'mouse') {
                  e.currentTarget.blur();
                }
                onScrubEnd();
              }}
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

          <span className="shrink-0 text-[11px] font-medium text-white/70 tabular-nums sm:text-xs">
            {hasFiniteDuration ? formatMediaTime(duration) : '--:--'}
          </span>
        </div>

        <div className="grid grid-cols-2 items-center gap-x-2 gap-y-1.5 sm:grid-cols-[1fr_auto_1fr] sm:gap-2">
          <div className="order-2 flex items-center gap-0.5 justify-self-start sm:order-1 sm:gap-1">
            <VideoVolumeControl
              isMuted={isMuted}
              volume={volume}
              subtleBtnClass={subtleBtnClass}
              onToggleMute={onToggleMute}
              onChangeVolume={onChangeVolume}
              onScrubStart={onScrubStart}
              onScrubEnd={onScrubEnd}
            />

            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={isLooping}
              aria-label={isLooping ? 'Matikan ulangi otomatis' : 'Aktifkan ulangi otomatis'}
              title={isLooping ? 'Ulangi otomatis aktif' : 'Ulangi otomatis'}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 sm:h-9 sm:w-9 ${
                isLooping
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : subtleBtnClass
              }`}
            >
              <Repeat size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={cycleMobileZoom}
              aria-label={`Ubah zoom video (${Math.round(zoom * 100)}%)`}
              title="Ubah tingkat zoom"
              className={`inline-flex h-8 min-w-[38px] items-center justify-center rounded-[var(--radius-sm)] px-1.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 sm:hidden ${
                zoom !== 1
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : subtleBtnClass
              }`}
            >
              {Math.round(zoom * 100)}%
            </button>

            <div className="hidden items-center gap-0.5 sm:inline-flex">
              <button
                type="button"
                disabled={zoom <= MEDIA_MIN_ZOOM}
                onClick={() => onApplyZoom(zoom - MEDIA_ZOOM_STEP)}
                aria-label="Perkecil video"
                title="Perkecil video (-)"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${subtleBtnClass}`}
              >
                <ZoomOut size={16} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onResetZoom}
                aria-label="Reset zoom, rotasi, dan flip video"
                title="Reset tampilan ke 100% (0)"
                className={`inline-flex h-9 min-w-[46px] items-center justify-center rounded-[var(--radius-sm)] px-1.5 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                  zoom !== 1
                    ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                    : subtleBtnClass
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
                className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${subtleBtnClass}`}
              >
                <ZoomIn size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            role="group"
            aria-label="Kontrol pemutaran utama"
            className="order-1 col-span-2 flex items-center justify-center gap-1 justify-self-center sm:order-2 sm:col-span-1 sm:gap-1.5"
          >
            <button
              type="button"
              disabled={totalItems <= 1}
              onClick={onPrev}
              aria-label="Video sebelumnya"
              title={
                totalItems > 1
                  ? 'Video sebelumnya (Ctrl+Panah kiri)'
                  : 'Tidak ada video sebelumnya'
              }
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 sm:w-9 ${subtleBtnClass}`}
            >
              <SkipBack size={16} aria-hidden="true" className="fill-current" />
            </button>

            <span aria-hidden="true" className="h-4 w-px bg-white/15" />

            <button
              type="button"
              disabled={!hasFiniteDuration}
              onClick={() => onSeekBy(-10)}
              aria-label="Mundur 10 detik"
              title="Mundur 10 detik (Panah kiri)"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 sm:w-9 ${subtleBtnClass}`}
            >
              <Rewind size={16} aria-hidden="true" className="fill-current" />
            </button>

            <span aria-hidden="true" className="h-4 w-px bg-white/15" />

            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Jeda video' : isEnded ? 'Putar ulang video' : 'Putar video'}
              title={isPlaying ? 'Jeda (Spasi)' : isEnded ? 'Putar ulang (Spasi)' : 'Putar (Spasi)'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-amber)] text-white transition-[filter] duration-150 hover:brightness-105"
            >
              {isPlaying ? (
                <Pause size={17} aria-hidden="true" className="fill-current" />
              ) : isEnded ? (
                <RotateCcw size={17} aria-hidden="true" />
              ) : (
                <Play size={17} aria-hidden="true" className="translate-x-0.5 fill-current" />
              )}
            </button>

            <span aria-hidden="true" className="h-4 w-px bg-white/15" />

            <button
              type="button"
              disabled={!hasFiniteDuration}
              onClick={() => onSeekBy(10)}
              aria-label="Maju 10 detik"
              title="Maju 10 detik (Panah kanan)"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 sm:w-9 ${subtleBtnClass}`}
            >
              <FastForward size={16} aria-hidden="true" className="fill-current" />
            </button>

            <span aria-hidden="true" className="h-4 w-px bg-white/15" />

            <button
              type="button"
              disabled={totalItems <= 1}
              onClick={onNext}
              aria-label="Video berikutnya"
              title={
                totalItems > 1
                  ? 'Video berikutnya (Ctrl+Panah kanan)'
                  : 'Tidak ada video berikutnya'
              }
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 sm:w-9 ${subtleBtnClass}`}
            >
              <SkipForward size={16} aria-hidden="true" className="fill-current" />
            </button>
          </div>

          <div className="order-3 flex items-center justify-end gap-0.5 justify-self-end sm:gap-1">
            <button
              type="button"
              onClick={onToggleFlipX}
              aria-pressed={flipX}
              aria-label="Balik video horizontal"
              title="Balik horizontal (H)"
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 sm:h-9 sm:w-9 ${
                flipX
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : subtleBtnClass
              }`}
            >
              <FlipHorizontal2 size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onToggleFlipY}
              aria-pressed={flipY}
              aria-label="Balik video vertikal"
              title="Balik vertikal (V)"
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 sm:h-9 sm:w-9 ${
                flipY
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : subtleBtnClass
              }`}
            >
              <FlipVertical2 size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onRotate}
              aria-label="Putar video 90 derajat"
              title="Putar 90° (R)"
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 sm:h-9 sm:w-9 ${
                rotation !== 0
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : subtleBtnClass
              }`}
            >
              <RotateCw size={16} aria-hidden="true" />
            </button>

            <VideoSpeedControl
              playbackRate={playbackRate}
              subtleBtnClass={subtleBtnClass}
              onChangeSpeed={onChangeSpeed}
              onSpeedMenuOpenChange={onSpeedMenuOpenChange}
            />
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
