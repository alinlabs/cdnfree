import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Film,
  Maximize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateVideoPreview,
  formatCompactAssetBadge,
  getAssetFilename,
  getVideoFormatLabel,
} from '../../../utils/asset-explorer';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
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
  hasFailed: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onActivatePlayer: () => void;
  onMarkFailed?: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
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
  hasFailed,
  downloadState,
  copied,
  isBookmarked = false,
  onToggleBookmark,
  onActivatePlayer,
  onMarkFailed,
  onToggleMenu,
  onCloseMenu,
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
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failureKind, setFailureKind] = useState<VideoPlaybackFailureKind | null>(null);
  const [useDirectUrl, setUseDirectUrl] = useState(false);
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [posterFallbackDirect, setPosterFallbackDirect] = useState(false);
  const [posterLoadFailed, setPosterLoadFailed] = useState(false);

  const filename = getAssetFilename(resource.url);
  const formatLabel = getVideoFormatLabel(resource);
  const cornerBadge = formatCompactAssetBadge(formatLabel, resource.declaredBytes);
  const previewDecision = evaluateVideoPreview(resource);
  const showNativePlayer = previewDecision.canRenderVideo && !hasFailed && failureKind === null;
  const eligibility = getAssetDownloadEligibility(resource);
  const proxySrc = buildProxyAssetUrl(resource.url, inspectionId);
  const activeSrc = useDirectUrl ? resource.url : proxySrc;
  const activePosterSrc =
    capturedPoster ??
    (!posterLoadFailed && resource.posterUrl
      ? posterFallbackDirect
        ? resource.posterUrl
        : buildProxyAssetUrl(resource.posterUrl, inspectionId)
      : undefined);

  useEffect(() => {
    thumbnailSeekedRef.current = false;
  }, [activeSrc]);

  useEffect(() => {
    if (!isActivePlayer && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isActivePlayer]);

  const tryCaptureThumbnail = (video: HTMLVideoElement) => {
    if (useDirectUrl || capturedPoster) return;
    const dataUrl = captureVideoFramePoster(video);
    if (dataUrl) {
      setCapturedPoster(dataUrl);
    }
  };

  const handleInlinePlayToggle = () => {
    if (!showNativePlayer) {
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
    onOpenFullView();
  };

  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = hasFiniteDuration
    ? Math.min(100, (currentTime / duration) * 100)
    : 0;

  return (
    <li
      className={`relative aspect-video min-w-0 ${isMenuOpen ? 'z-30' : 'z-0'}`}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#141414] transition-colors duration-150 hover:border-[var(--color-amber)]">
        {showNativePlayer ? (
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
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
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
                if (!useDirectUrl && kind !== 'decode') {
                  if (hasStartedRef.current) {
                    pendingPlayRef.current = true;
                  }
                  setUseDirectUrl(true);
                  return;
                }
                setFailureKind(kind);
                onMarkFailed?.();
              }}
              className="h-full w-full cursor-pointer object-contain"
            />

            {!hasStarted || !isPlaying ? (
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
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-[#141414]/85 text-white shadow-lg transition-colors duration-150 group-hover:border-[var(--color-amber)] group-hover:bg-[var(--color-amber)] group-hover:text-[#141414]">
                  <Play
                    size={18}
                    aria-hidden="true"
                    className="translate-x-0.5 fill-current"
                  />
                </span>
              </button>
            ) : null}

            {hasStarted ? (
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pb-2 pt-5">
                <button
                  type="button"
                  onClick={handleInlinePlayToggle}
                  aria-label={isPlaying ? `Jeda ${filename}` : `Putar ${filename}`}
                  title={isPlaying ? 'Jeda' : 'Putar'}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
                >
                  {isPlaying ? (
                    <Pause size={13} aria-hidden="true" className="fill-current" />
                  ) : (
                    <Play
                      size={13}
                      aria-hidden="true"
                      className="translate-x-0.5 fill-current"
                    />
                  )}
                </button>

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

                <span className="shrink-0 text-[11px] text-white/90 tabular-nums whitespace-nowrap">
                  {formatMediaTime(currentTime)} / {hasFiniteDuration ? formatMediaTime(duration) : '--:--'}
                </span>

                <button
                  type="button"
                  onClick={handleToggleMute}
                  aria-label={
                    isMuted ? `Bunyikan ${filename}` : `Bisukan ${filename}`
                  }
                  title={isMuted ? 'Bunyikan' : 'Bisukan'}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/85 transition-colors duration-150 hover:bg-white/15 hover:text-white"
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
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/90 transition-colors duration-150 hover:bg-white/15 hover:text-white"
                >
                  <Maximize2 size={13} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </>
        ) : previewDecision.status === 'restricted' ? (
          <div className="flex h-full flex-col items-center justify-center bg-[var(--color-surface-subtle)] p-4 text-center">
            <Film
              size={22}
              aria-hidden="true"
              className="text-[var(--color-text-soft)]"
            />
            <p className="mt-2 max-w-[34ch] text-xs leading-relaxed text-[var(--color-text-muted)]">
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
            <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors duration-150 group-hover:bg-black/35">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-[#141414]/85 text-white shadow-lg transition-colors duration-150 group-hover:border-[var(--color-amber)] group-hover:bg-[var(--color-amber)] group-hover:text-[#141414]">
                <Play
                  size={18}
                  aria-hidden="true"
                  className="translate-x-0.5 fill-current"
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
            className="group flex h-full w-full cursor-pointer flex-col items-center justify-center bg-[#141414] px-4 text-center transition-colors duration-150 hover:bg-[#1b1b1e]"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white shadow-lg transition-colors duration-150 group-hover:border-[var(--color-amber)] group-hover:bg-[var(--color-amber)] group-hover:text-[#141414]">
              <Play
                size={18}
                aria-hidden="true"
                className="translate-x-0.5 fill-current"
              />
            </span>
            <span className="mt-2.5 max-w-[28ch] truncate text-xs font-medium text-white/85">
              {filename}
            </span>
            <span className="mt-0.5 text-[11px] text-white/55">
              Klik untuk membuka pemutar
            </span>
          </button>
        )}
      </div>

      <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 max-w-[calc(100%-6.75rem)] truncate rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-text)] tabular-nums sm:top-2 sm:left-2">
        {cornerBadge}
      </span>

      <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 sm:top-2 sm:right-2">
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
            className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border transition-colors duration-150 ${
              isBookmarked
                ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
            }`}
          >
            <Bookmark
              size={13}
              aria-hidden="true"
              className={isBookmarked ? 'fill-current' : ''}
            />
          </button>
        ) : null}

        <button
          type="button"
          onClick={handleZoomToFullView}
          aria-label={`Buka tampilan penuh ${filename}`}
          title="Perbesar ke tampilan penuh"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <Maximize2 size={13} aria-hidden="true" />
        </button>

        <AssetCardMenu
          resource={resource}
          filename={filename}
          formatLabel={formatLabel}
          isOpen={isMenuOpen}
          alignClassName="right-0"
          menuTitle="Info & aksi video"
          eligibleForDownload={eligibility.eligible}
          downloadState={downloadState}
          copied={copied}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onToggle={onToggleMenu}
          onDownload={onDownload}
          onCopy={onCopy}
          onOpenFullView={handleZoomToFullView}
          containerRef={menuContainerRef}
          triggerSizeClass="h-7 w-7"
        />
      </div>
    </li>
  );
}
