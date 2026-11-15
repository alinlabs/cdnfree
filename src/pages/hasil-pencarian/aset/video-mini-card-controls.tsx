import { Maximize2, Volume2, VolumeX } from 'lucide-react';
import { formatMediaTime } from '../media-player/media-player-utils';

interface VideoMiniCardControlsProps {
  filename: string;
  currentTime: number;
  duration: number;
  isMuted: boolean;
  isMenuOpen: boolean;
  onSeekTo: (nextTime: number) => void;
  onToggleMute: () => void;
  onZoomToFullView: () => void;
}

export function VideoMiniCardControls({
  filename,
  currentTime,
  duration,
  isMuted,
  isMenuOpen,
  onSeekTo,
  onToggleMute,
  onZoomToFullView,
}: VideoMiniCardControlsProps) {
  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = hasFiniteDuration
    ? Math.min(100, (currentTime / duration) * 100)
    : 0;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-1.5 pb-1.5 pt-4 transition-opacity duration-150 sm:gap-1.5 sm:px-2.5 sm:pb-2 sm:pt-5 ${
        isMenuOpen
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-has-[:focus-visible]/card:pointer-events-auto group-has-[:focus-visible]/card:opacity-100'
      }`}
    >
      <div className="relative flex h-5 min-w-0 flex-1 items-center">
        <div className="pointer-events-none relative h-1 w-full overflow-hidden rounded-full bg-white/25">
          {hasFiniteDuration ? (
            <div
              style={{ width: `${progressPct}%` }}
              className="absolute inset-y-0 left-0 bg-[var(--color-amber)]"
            />
          ) : (
            <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse bg-[var(--color-amber)]/65" />
          )}
        </div>
        <input
          type="range"
          min={0}
          max={hasFiniteDuration ? duration : 1}
          step={0.1}
          disabled={!hasFiniteDuration}
          value={hasFiniteDuration ? Math.min(currentTime, duration) : 0}
          onPointerUp={(e) => {
            if (e.pointerType === 'mouse') {
              e.currentTarget.blur();
            }
          }}
          onChange={(e) => {
            if (!hasFiniteDuration) return;
            onSeekTo(Number(e.target.value));
          }}
          aria-label={`Posisi durasi mini ${filename}`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>

      <span className="shrink-0 text-[10px] text-white/90 tabular-nums whitespace-nowrap sm:text-[11px]">
        {formatMediaTime(currentTime)}
        <span className="hidden sm:inline">
          {' '}/ {hasFiniteDuration ? formatMediaTime(duration) : '--:--'}
        </span>
      </span>

      <button
        type="button"
        onClick={onToggleMute}
        aria-label={isMuted ? `Bunyikan ${filename}` : `Bisukan ${filename}`}
        title={isMuted ? 'Bunyikan' : 'Bisukan'}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/85 transition-colors duration-150 hover:bg-white/15 hover:text-white sm:h-7 sm:w-7"
      >
        {isMuted ? (
          <VolumeX size={13} aria-hidden="true" />
        ) : (
          <Volume2 size={13} aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={onZoomToFullView}
        aria-label={`Perbesar video ${filename} ke tampilan penuh`}
        title="Tampilan penuh (Zoom)"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/90 transition-colors duration-150 hover:bg-white/15 hover:text-white sm:h-7 sm:w-7"
      >
        <Maximize2 size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
