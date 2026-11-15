import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Film,
  Maximize2,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useInView } from '../../../hooks/use-in-view';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateVideoPreview,
  formatCompactAssetBadge,
  getAssetFilename,
  getVideoFormatLabel,
  isUnverifiedAsset,
} from '../../../utils/asset-explorer';
import {
  buildProxyAssetUrl,
  resolveInlineStreamUrl,
} from '../../../utils/proxy-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { requestAppFullscreen } from '../media-player/media-fullscreen';
import {
  formatMediaTime,
  mapVideoMediaError,
  type VideoPlaybackFailureKind,
} from '../media-player/media-player-utils';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';
import { AssetCardMenu } from './asset-card-menu';

interface VideoMiniCardProps {
  inspectionId: string;
  resource: ResourceRecord;
  isActivePlayer: boolean;
  isMenuOpen: boolean;
  menuAlignClassName?: string;
  hasFailed: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onActivatePlayer: () => void;
  onMarkFailed?: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpenInfo: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onOpenFullView: () => void;
  menuContainerRef: (node: HTMLDivElement | null) => void;
}

function captureVideoFramePoster(video: HTMLVideoElement): string | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  try {
    const targetWidth = Math.min(480, video.videoWidth);
    const targetHeight = Math.max(
      1,
      Math.round((video.videoHeight / video.videoWidth) * targetWidth),
    );
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

export function VideoMiniCard({
  inspectionId,
  resource,
  isActivePlayer,
  isMenuOpen,
  menuAlignClassName = 'right-0',
  hasFailed,
  downloadState,
  copied,
  isBookmarked = false,
  onToggleBookmark,
  onActivatePlayer,
  onMarkFailed,
  onToggleMenu,
  onCloseMenu,
  onOpenInfo,
  onDownload,
  onCopy,
  onOpenFullView,
  menuContainerRef,
}: VideoMiniCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasStartedRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const thumbnailSeekedRef = useRef(false);

  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failureKind, setFailureKind] = useState<VideoPlaybackFailureKind | null>(null);
  const [useStreamFallback, setUseStreamFallback] = useState(false);
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [posterFallbackDirect, setPosterFallbackDirect] = useState(false);
  const [posterLoadFailed, setPosterLoadFailed] = useState(false);
  const { ref: cardRef, inView } = useInView();

  const filename = getAssetFilename(resource.url);
  const formatLabel = getVideoFormatLabel(resource);
  const cornerBadge = formatCompactAssetBadge(formatLabel, resource.declaredBytes);
  const previewDecision = evaluateVideoPreview(resource);
  const unverified = isUnverifiedAsset(resource);
  const showNativePlayer = previewDecision.canRenderVideo && !hasFailed && failureKind === null;
  const eligibility = getAssetDownloadEligibility(resource);
  const streamSrc = resolveInlineStreamUrl(resource, inspectionId);
  const activeSrc = useStreamFallback ? streamSrc : resource.url;
  const activePosterSrc =
    capturedPoster ??
    (!posterLoadFailed && resource.posterUrl
      ? posterFallbackDirect
        ? resource.posterUrl
        : buildProxyAssetUrl(resource.posterUrl, inspectionId)
      : undefined);

  useEffect(() => {
    thumbnailSeekedRef.current = false;
    setIsMuted(true);
  }, [activeSrc]);

  useEffect(() => {
    if (!isActivePlayer && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isActivePlayer]);

  const tryCaptureThumbnail = (video: HTMLVideoElement) => {
    if (!useStreamFallback || capturedPoster) return;
    const dataUrl = captureVideoFramePoster(video);
    if (dataUrl) {
      setCapturedPoster(dataUrl);
    }
  };

  const handleInlinePlayToggle = () => {
    if (!showNativePlayer) {
      requestAppFullscreen();
      onOpenFullView();
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      setHasStarted(true);
      if (video.currentTime > 0 && video.currentTime <= 0.6) {
        try {
          video.currentTime = 0;
        } catch {
          // Ignore seek errors before ready
        }
      }
    }

    if (video.paused || video.ended) {
      if (video.ended) {
        video.currentTime = 0;
        setCurrentTime(0);
      }
      video.muted = isMuted;
      onActivatePlayer();
      void video.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      video.pause();
    }
  };

  const handleToggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const handleZoomToFullView = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    onCloseMenu();
    requestAppFullscreen();
    onOpenFullView();
  };

  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = hasFiniteDuration
    ? Math.min(100, (currentTime / duration) * 100)
    : 0;

  return (
    <li
      ref={cardRef}
      className={`group/card relative aspect-video min-w-0 ${isMenuOpen ? 'z-30' : 'z-0'}`}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#141414]">
        {showNativePlayer && inView ? (
          <>
            <video
              ref={videoRef}
              key={activeSrc}
              src={activeSrc}
              poster={activePosterSrc}
              preload="metadata"
              playsInline
              muted={isMuted}
              aria-label={`Pemutar mini video ${filename}`}
              onClick={handleInlinePlayToggle}
              onWaiting={() => {
                if (hasStartedRef.current) setIsBuffering(true);
              }}
              onPlaying={() => {
                setIsPlaying(true);
                setIsBuffering(false);
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => {
                setIsPlaying(false);
                setIsBuffering(false);
              }}
              onEnded={() => {
                setIsPlaying(false);
                setIsBuffering(false);
              }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                const validDuration =
                  Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
                setDuration(validDuration);
                if (
                  !hasStartedRef.current &&
                  !thumbnailSeekedRef.current &&
                  validDuration > 0.25 &&
                  v.currentTime < 0.05
                ) {
                  thumbnailSeekedRef.current = true;
                  try {
                    v.currentTime = Math.min(0.35, validDuration * 0.1);
                  } catch {
                    // Ignore initial thumbnail seek failures
                  }
                }
              }}
              onDurationChange={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && v.duration > 0) {
                  setDuration(v.duration);
                }
              }}
              onLoadedData={(e) => {
                tryCaptureThumbnail(e.currentTarget);
              }}
              onSeeked={(e) => {
                if (!hasStartedRef.current) {
                  tryCaptureThumbnail(e.currentTarget);
                }
              }}
              onCanPlay={(e) => {
                setIsBuffering(false);
                if (pendingPlayRef.current) {
                  pendingPlayRef.current = false;
                  void e.currentTarget.play().catch(() => {
                    setIsPlaying(false);
                  });
                }
              }}
              onTimeUpdate={(e) => {
                if (hasStartedRef.current) {
                  setCurrentTime(e.currentTarget.currentTime);
                }
              }}
              onError={(e) => {
                const kind = mapVideoMediaError(e.currentTarget.error?.code);
                if (!useStreamFallback && kind !== 'decode') {
                  if (hasStartedRef.current) {
                    pendingPlayRef.current = true;
                  }
                  setUseStreamFallback(true);
                  return;
                }
                setFailureKind(kind);
                onMarkFailed?.();
              }}
              className="h-full w-full cursor-pointer object-contain"
            />

            {!hasStarted && hasFiniteDuration ? (
              <span
                className={`pointer-events-none absolute right-1.5 bottom-1.5 z-10 text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] tabular-nums transition-opacity duration-150 sm:right-2.5 sm:bottom-2 sm:text-[11px] ${
                  isMenuOpen
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
                }`}
              >
                {formatMediaTime(duration)}
              </span>
            ) : null}

            {isBuffering && hasStarted ? (
              <div
                aria-label={`Memuat ${filename}`}
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
              >
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-[var(--color-amber)] sm:h-8 sm:w-8" />
              </div>
            ) : !hasStarted || !isPlaying ? (
              <button
                type="button"
                onClick={handleInlinePlayToggle}
                aria-label={
                  hasStarted
                    ? `Lanjutkan pemutaran mini ${filename}`
                    : `Putar video ${filename} dalam mode mini`
                }
                title="Putar video di halaman ini"
                className="group absolute inset-0 z-0 flex cursor-pointer items-center justify-center bg-black/20 transition-colors duration-150 hover:bg-black/30"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-amber)] text-white shadow-lg transition-[transform,filter] duration-150 group-hover:scale-105 group-hover:brightness-105 sm:h-11 sm:w-11">
                  <Play
                    size={18}
                    aria-hidden="true"
                    className="h-4 w-4 translate-x-0.5 fill-current sm:h-[18px] sm:w-[18px]"
                  />
                </span>
              </button>
            ) : null}

            {hasStarted ? (
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
                      const nextTime = Number(e.target.value);
                      if (videoRef.current) {
                        videoRef.current.currentTime = nextTime;
                      }
                      setCurrentTime(nextTime);
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
                  onClick={handleToggleMute}
                  aria-label={
                    isMuted ? `Bunyikan ${filename}` : `Bisukan ${filename}`
                  }
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
                  onClick={handleZoomToFullView}
                  aria-label={`Perbesar video ${filename} ke tampilan penuh`}
                  title="Tampilan penuh (Zoom)"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/90 transition-colors duration-150 hover:bg-white/15 hover:text-white sm:h-7 sm:w-7"
                >
                  <Maximize2 size={13} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </>
        ) : showNativePlayer ? (
          <div className="h-full w-full bg-[#141414]" />
        ) : previewDecision.status === 'restricted' ? (
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
        ) : activePosterSrc ? (
          <button
            type="button"
            onClick={handleZoomToFullView}
            aria-label={`Putar video ${filename}`}
            title="Buka pemutar video"
            className="group relative block h-full w-full cursor-pointer overflow-hidden"
          >
            <img
              src={activePosterSrc}
              alt={`Thumbnail ${filename}`}
              onError={() => {
                if (!posterFallbackDirect && resource.posterUrl) {
                  setPosterFallbackDirect(true);
                } else {
                  setPosterLoadFailed(true);
                }
              }}
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
        ) : (
          <button
            type="button"
            onClick={handleZoomToFullView}
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
        )}

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-[30%] bg-gradient-to-b from-black/60 via-black/25 to-transparent transition-opacity duration-150 ${
            isMenuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          }`}
        />

        <span
          className={`pointer-events-none absolute top-1.5 left-2 z-10 max-w-[calc(100%-3.75rem)] truncate text-[10px] font-medium text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] tabular-nums transition-opacity duration-150 sm:top-2 sm:left-2.5 sm:max-w-[calc(100%-4.5rem)] sm:text-[11px] ${
            isMenuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          }`}
        >
          {cornerBadge}
        </span>
        {unverified ? (
          <span className="pointer-events-none absolute bottom-1.5 left-2 z-10 truncate rounded-[2px] bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            belum terverifikasi
          </span>
        ) : null}
      </div>

      <div
        className={`absolute top-1 right-1 z-20 flex items-center gap-0.5 transition-opacity duration-150 sm:top-2 sm:right-2 sm:gap-1 ${
          isMenuOpen
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover/card:opacity-100 group-hover/card:pointer-events-auto group-focus-within/card:opacity-100 group-focus-within/card:pointer-events-auto'
        }`}
      >
        {onToggleBookmark ? (
          <button
            type="button"
            onClick={onToggleBookmark}
            aria-label={
              isBookmarked
                ? `Hapus ${filename} dari markah`
                : `Simpan ${filename} ke markah`
            }
            aria-pressed={isBookmarked}
            title={
              isBookmarked ? 'Tersimpan di markah (hapus)' : 'Simpan ke markah'
            }
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-[color,transform] duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-[var(--color-amber)] sm:h-7 sm:w-7 ${
              isBookmarked
                ? 'text-[var(--color-amber)]'
                : 'text-white/90 hover:text-white'
            }`}
          >
            <Bookmark
              size={16}
              aria-hidden="true"
              className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isBookmarked ? 'fill-current' : ''}`}
            />
          </button>
        ) : null}

        <AssetCardMenu
          filename={filename}
          isOpen={isMenuOpen}
          alignClassName={menuAlignClassName}
          menuTitle="Opsi video"
          eligibleForDownload={eligibility.eligible}
          downloadState={downloadState}
          copied={copied}
          onToggle={onToggleMenu}
          onOpenInfo={onOpenInfo}
          onCopy={onCopy}
          onDownload={onDownload}
          containerRef={menuContainerRef}
          triggerSizeClass="h-6 w-6 sm:h-7 sm:w-7"
        />
      </div>
    </li>
  );
}
