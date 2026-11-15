import { Film, Play } from 'lucide-react';
import type { VideoPreviewDecision } from '../../../utils/asset-explorer';

interface VideoMiniCardFallbackProps {
  showNativePlayer: boolean;
  previewDecision: VideoPreviewDecision;
  activePosterSrc?: string;
  filename: string;
  onPosterError: () => void;
  onZoomToFullView: () => void;
}

export function VideoMiniCardFallback({
  showNativePlayer,
  previewDecision,
  activePosterSrc,
  filename,
  onPosterError,
  onZoomToFullView,
}: VideoMiniCardFallbackProps) {
  if (showNativePlayer) {
    return <div className="h-full w-full bg-[#141414]" />;
  }

  if (previewDecision.status === 'restricted') {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--color-surface-subtle)] p-2 text-center sm:p-4">
        <Film
          size={22}
          aria-hidden="true"
          className="h-[18px] w-[18px] text-[var(--color-text-soft)] sm:h-[22px] sm:w-[22px]"
        />
        <p className="mt-1 line-clamp-2 max-w-[34ch] text-[10px] leading-snug text-[var(--color-text-muted)] sm:mt-2 sm:line-clamp-none sm:text-xs sm:leading-relaxed">
          {previewDecision.note}
        </p>
      </div>
    );
  }

  if (activePosterSrc) {
    return (
      <button
        type="button"
        onClick={onZoomToFullView}
        aria-label={`Putar video ${filename}`}
        title="Buka pemutar video"
        className="group relative block h-full w-full cursor-pointer overflow-hidden"
      >
        <img
          src={activePosterSrc}
          alt={`Thumbnail ${filename}`}
          onError={onPosterError}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors duration-150 group-hover:bg-black/30">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-amber)] text-white shadow-lg transition-[transform,filter] duration-150 group-hover:scale-105 group-hover:brightness-105 sm:h-11 sm:w-11">
            <Play
              size={18}
              aria-hidden="true"
              className="h-4 w-4 translate-x-0.5 fill-current sm:h-[18px] sm:w-[18px]"
            />
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onZoomToFullView}
      aria-label={`Buka pemutar video ${filename}`}
      title="Buka pemutar video"
      className="group flex h-full w-full cursor-pointer items-center justify-center bg-[#141414] transition-colors duration-150 hover:bg-[#1b1b1e]"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-amber)] text-white shadow-lg transition-[transform,filter] duration-150 group-hover:scale-105 group-hover:brightness-105 sm:h-11 sm:w-11">
        <Play
          size={18}
          aria-hidden="true"
          className="h-4 w-4 translate-x-0.5 fill-current sm:h-[18px] sm:w-[18px]"
        />
      </span>
    </button>
  );
}
