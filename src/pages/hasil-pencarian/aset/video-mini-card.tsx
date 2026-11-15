import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useInView } from '../../../hooks/use-in-view';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateVideoPreview,
  formatCompactAssetBadge,
  getAssetFilename,
  getVideoFormatLabel,
  isUnverifiedAsset,
} from '../../../utils/asset-explorer';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { requestAppFullscreen } from '../media-player/media-fullscreen';
import {
  formatMediaTime,
  mapVideoMediaError,
  type VideoPlaybackFailureKind,
} from '../media-player/media-player-utils';
import { useHlsPlayer } from '../media-player/use-hls-player';
import { computeSeekTarget, computeSteppedVolume } from '../media-player/video-shortcuts';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';
import { useVideoMiniCardShortcuts } from './use-video-mini-card-shortcuts';
import { useVideoMiniCardSync } from './use-video-mini-card-sync';
import { VideoMiniCardControls } from './video-mini-card-controls';
import { VideoMiniCardFallback } from './video-mini-card-fallback';
import { VideoMiniCardOverlay } from './video-mini-card-overlay';

interface VideoMiniCardProps {
  inspectionId: string;
  resource: ResourceRecord;
  isActivePlayer: boolean;
  isSeekVolumeShortcutTarget?: boolean;
  isDownloadShortcutTarget?: boolean;
  isMenuOpen: boolean;
  menuAlignClassName?: string;
  hasFailed: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onActivatePlayer: () => void;
  onPlayingChange?: (playing: boolean) => void;
  onHoverChange?: (hovered: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  onMarkFailed?: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpenInfo: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onOpenFullView: () => void;
  menuContainerRef: (node: HTMLDivElement | null) => void;
}

export function VideoMiniCard({
  inspectionId,
  resource,
  isActivePlayer,
  isSeekVolumeShortcutTarget = false,
  isDownloadShortcutTarget = false,
  isMenuOpen,
  menuAlignClassName = 'right-0',
  hasFailed,
  downloadState,
  copied,
  isBookmarked = false,
  onToggleBookmark,
  onActivatePlayer,
  onPlayingChange,
  onHoverChange,
  onFocusChange,
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
  const pendingResumeSeekRef = useRef<number | null>(null);
  const pendingShortcutSeekDeltaRef = useRef<number | null>(null);
  const thumbnailSeekedRef = useRef(false);
  const lastThrottleSaveRef = useRef(0);
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failureKind, setFailureKind] = useState<VideoPlaybackFailureKind | null>(null);
  const [posterFallbackDirect, setPosterFallbackDirect] = useState(false);
  const [posterLoadFailed, setPosterLoadFailed] = useState(false);
  const { ref: cardRef, inView } = useInView();

  const sync = useVideoMiniCardSync({
    resource,
    inspectionId,
    inView,
    isPlaying,
    isBookmarked,
    hasStartedRef,
    videoRef,
    isActivePlayer,
    onActivatePlayer,
    onResumeFromStore: (snap, shouldAutoPlay) => {
      hasStartedRef.current = true;
      setHasStarted(true);
      setCurrentTime(snap.currentTime);
      if (snap.duration > 0) setDuration(snap.duration);
      pendingResumeSeekRef.current = snap.currentTime;
      const v = videoRef.current;
      if (v && v.readyState >= 1) {
        try {
          v.currentTime = snap.currentTime;
          pendingResumeSeekRef.current = null;
        } catch {
          // Wait for loadedmetadata / canplay
        }
      }
      if (shouldAutoPlay && v) {
        v.muted = true;
        setIsMuted(true);
        onActivatePlayer();
        void v.play().catch(() => setIsPlaying(false));
      }
    },
  });

  const { sourcePlan } = sync;
  const filename = getAssetFilename(resource.url);
  const formatLabel = getVideoFormatLabel(resource);
  const cornerBadge = formatCompactAssetBadge(formatLabel, resource.declaredBytes);
  const previewDecision = evaluateVideoPreview(resource);
  const unverified = isUnverifiedAsset(resource);
  const showNativePlayer = previewDecision.canRenderVideo && !hasFailed && failureKind === null;
  const eligibility = getAssetDownloadEligibility(resource);

  const isHls = sourcePlan.isHls;
  const activeSrc = isHls ? undefined : sourcePlan.activeSrc;

  const activePosterSrc =
    sync.cachedPoster ??
    (!posterLoadFailed && resource.posterUrl
      ? posterFallbackDirect
        ? resource.posterUrl
        : buildProxyAssetUrl(resource.posterUrl, inspectionId, resource.referer)
      : undefined);

  useHlsPlayer({
    videoRef,
    hlsUrl: isHls ? sourcePlan.hlsSrc : null,
    enabled: isHls && showNativePlayer && inView && sync.canLoadMetadata,
    startPosition: 0,
    autoStartLoad: hasStarted || sync.userEngaged,
    previewFirstFragment: !hasStarted && sync.canLoadMetadata && !sync.cachedPoster,
    onReady: () => {
      setIsBuffering(false);
      sync.releasePreloadSlot();
    },
    onError: (kind) => {
      sync.releasePreloadSlot();
      setFailureKind(kind);
      onMarkFailed?.();
    },
  });

  useEffect(() => {
    thumbnailSeekedRef.current = false;
    setIsMuted(true);
    setVolume(1);
  }, [activeSrc, sourcePlan.hlsSrc]);

  useEffect(() => {
    if (!isActivePlayer && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isActivePlayer]);

  useEffect(() => {
    return () => {
      onPlayingChangeRef.current?.(false);
    };
  }, []);

  const applyPendingCardSeek = (v: HTMLVideoElement) => {
    const target = pendingResumeSeekRef.current;
    if (target === null || target <= 0.15) {
      pendingResumeSeekRef.current = null;
      return;
    }
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const clamped = dur > 0 ? Math.min(target, Math.max(0, dur - 0.1)) : target;
    try {
      v.currentTime = clamped;
      setCurrentTime(clamped);
      pendingResumeSeekRef.current = null;
    } catch {
      // Wait for next readiness event
    }
  };

  const handleInlinePlayToggle = () => {
    if (!showNativePlayer) {
      requestAppFullscreen();
      onOpenFullView();
      return;
    }
    sync.markEngaged();
    sync.releasePreloadSlot();
    const video = videoRef.current;
    if (!video) return;

    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      setHasStarted(true);
      if (pendingResumeSeekRef.current === null && video.currentTime > 0 && video.currentTime <= 0.6) {
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
    if (!nextMuted && volume === 0) {
      video.volume = 0.5;
      setVolume(0.5);
    }
  };

  const handleShortcutSeekBy = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video || !showNativePlayer) return;
    sync.markEngaged();
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      setHasStarted(true);
    }
    const targetDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const next = computeSeekTarget(video.currentTime, targetDuration, deltaSeconds);
    if (next === null) {
      pendingShortcutSeekDeltaRef.current =
        (pendingShortcutSeekDeltaRef.current ?? 0) + deltaSeconds;
      showShortcutHud(deltaSeconds > 0 ? `+${deltaSeconds}d` : `${deltaSeconds}d`);
      return;
    }
    pendingShortcutSeekDeltaRef.current = null;
    video.currentTime = next;
    setCurrentTime(next);
    sync.saveSnapshot({ currentTime: next }, true);
    showShortcutHud(deltaSeconds > 0 ? `+${deltaSeconds}d` : `${deltaSeconds}d`);
  };

  const handleShortcutVolumeBy = (delta: number) => {
    const video = videoRef.current;
    if (!video || !showNativePlayer) return;
    const next = computeSteppedVolume(volume, isMuted, delta);
    video.volume = next.volume;
    video.muted = next.isMuted;
    setVolume(next.volume);
    setIsMuted(next.isMuted);
    showShortcutHud(next.isMuted ? 'Bisu' : `Vol ${Math.round(next.volume * 100)}%`);
  };

  const { shortcutHud, showShortcutHud } = useVideoMiniCardShortcuts({
    isSeekVolumeTarget: isSeekVolumeShortcutTarget,
    isDownloadTarget: isDownloadShortcutTarget,
    canDownload: eligibility.eligible,
    isDownloading: downloadState.status === 'downloading',
    onSeekBy: handleShortcutSeekBy,
    onChangeVolumeBy: handleShortcutVolumeBy,
    onDownload,
  });

  const handleZoomToFullView = () => {
    const v = videoRef.current;
    if (v) {
      sync.prepareZoomToFullView(
        v.currentTime,
        Number.isFinite(v.duration) ? v.duration : duration,
        !v.paused && !v.ended,
        isMuted,
        sourcePlan.initialMode,
      );
      if (!v.paused) {
        v.pause();
      }
    }
    onCloseMenu();
    requestAppFullscreen();
    onOpenFullView();
  };

  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;

  return (
    <li
      ref={cardRef}
      onMouseEnter={() => {
        sync.markEngaged();
        onHoverChange?.(true);
      }}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocusCapture={() => onFocusChange?.(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onFocusChange?.(false);
        }
      }}
      className={`group/card relative aspect-video min-w-0 ${isMenuOpen ? 'z-30' : 'z-0'}`}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#141414]">
        {showNativePlayer && inView ? (
          <>
            <video
              ref={videoRef}
              key={isHls ? sourcePlan.hlsSrc : activeSrc}
              src={activeSrc}
              poster={activePosterSrc}
              preload={sync.canLoadMetadata ? 'metadata' : 'none'}
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
                onPlayingChange?.(true);
                sync.releasePreloadSlot();
              }}
              onPlay={() => {
                setIsPlaying(true);
                onPlayingChange?.(true);
              }}
              onPause={(e) => {
                setIsPlaying(false);
                setIsBuffering(false);
                onPlayingChange?.(false);
                if (!sync.suppressPauseSyncRef.current && hasStartedRef.current) {
                  sync.saveSnapshot(
                    { currentTime: e.currentTarget.currentTime, wasPlaying: false },
                    true,
                  );
                }
              }}
              onEnded={(e) => {
                setIsPlaying(false);
                setIsBuffering(false);
                onPlayingChange?.(false);
                if (hasStartedRef.current) {
                  sync.saveSnapshot(
                    { currentTime: e.currentTarget.currentTime, wasPlaying: false },
                    true,
                  );
                }
              }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                v.volume = volume;
                v.muted = isMuted;
                const validDuration =
                  Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
                setDuration(validDuration);
                sync.releasePreloadSlot();
                applyPendingCardSeek(v);
                if (pendingShortcutSeekDeltaRef.current !== null && validDuration > 0) {
                  const target = computeSeekTarget(
                    v.currentTime,
                    validDuration,
                    pendingShortcutSeekDeltaRef.current,
                  );
                  pendingShortcutSeekDeltaRef.current = null;
                  if (target !== null) {
                    v.currentTime = target;
                    setCurrentTime(target);
                    sync.saveSnapshot({ currentTime: target }, true);
                  }
                }
                if (
                  !hasStartedRef.current &&
                  pendingResumeSeekRef.current === null &&
                  !thumbnailSeekedRef.current &&
                  !sync.cachedPoster &&
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
              onLoadedData={(e) => sync.capturePoster(e.currentTarget)}
              onSeeked={(e) => {
                if (!hasStartedRef.current) sync.capturePoster(e.currentTarget);
              }}
              onCanPlay={(e) => {
                setIsBuffering(false);
                applyPendingCardSeek(e.currentTarget);
                if (pendingPlayRef.current) {
                  pendingPlayRef.current = false;
                  void e.currentTarget.play().catch(() => {
                    setIsPlaying(false);
                  });
                }
              }}
              onTimeUpdate={(e) => {
                if (!hasStartedRef.current) return;
                const v = e.currentTarget;
                setCurrentTime(v.currentTime);
                if (!v.paused && !v.ended) {
                  const now = Date.now();
                  if (now - lastThrottleSaveRef.current >= 400) {
                    lastThrottleSaveRef.current = now;
                    sync.saveSnapshot({
                      currentTime: v.currentTime,
                      duration: Number.isFinite(v.duration) ? v.duration : duration,
                      wasPlaying: true,
                    });
                  }
                }
              }}
              onError={(e) => {
                if (isHls) return;
                sync.releasePreloadSlot();
                sync.requestProxyThumbnailCapture();
                const kind = mapVideoMediaError(e.currentTarget.error?.code);
                setFailureKind(kind);
                onMarkFailed?.();
              }}
              className="h-full w-full cursor-pointer object-contain"
            />

            {!hasStarted && activePosterSrc ? (
              <img
                src={activePosterSrc}
                alt={`Thumbnail ${filename}`}
                onError={() => {
                  if (
                    !posterLoadFailed &&
                    resource.posterUrl &&
                    activePosterSrc !== sync.cachedPoster
                  ) {
                    if (!posterFallbackDirect) {
                      setPosterFallbackDirect(true);
                    } else {
                      setPosterLoadFailed(true);
                      sync.requestProxyThumbnailCapture();
                    }
                  }
                }}
                className="pointer-events-none absolute inset-0 z-0 h-full w-full bg-[#141414] object-contain"
              />
            ) : null}

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
                className="group absolute inset-0 z-[1] flex cursor-pointer items-center justify-center bg-black/20 transition-colors duration-150 hover:bg-black/30"
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
              <VideoMiniCardControls
                filename={filename}
                currentTime={currentTime}
                duration={duration}
                isMuted={isMuted}
                isMenuOpen={isMenuOpen}
                onSeekTo={(nextTime) => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = nextTime;
                  }
                  setCurrentTime(nextTime);
                  sync.saveSnapshot({ currentTime: nextTime }, true);
                }}
                onToggleMute={handleToggleMute}
                onZoomToFullView={handleZoomToFullView}
              />
            ) : null}
          </>
        ) : (
          <VideoMiniCardFallback
            showNativePlayer={showNativePlayer}
            previewDecision={previewDecision}
            activePosterSrc={activePosterSrc}
            filename={filename}
            onPosterError={() => {
              if (!posterFallbackDirect && resource.posterUrl) {
                setPosterFallbackDirect(true);
              } else {
                setPosterLoadFailed(true);
                sync.requestProxyThumbnailCapture();
              }
            }}
            onZoomToFullView={handleZoomToFullView}
          />
        )}

      </div>

      <VideoMiniCardOverlay
        filename={filename}
        cornerBadge={cornerBadge}
        shortcutHud={shortcutHud}
        unverified={unverified}
        isOfflineCached={sync.cacheEntry?.status === 'complete'}
        hasStarted={hasStarted}
        isMenuOpen={isMenuOpen}
        menuAlignClassName={menuAlignClassName}
        eligibleForDownload={eligibility.eligible}
        downloadState={downloadState}
        copied={copied}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        onToggleMenu={onToggleMenu}
        onOpenInfo={onOpenInfo}
        onCopy={onCopy}
        onDownload={onDownload}
        menuContainerRef={menuContainerRef}
      />
    </li>
  );
}
