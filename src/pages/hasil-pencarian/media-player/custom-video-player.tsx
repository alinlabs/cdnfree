import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play, RotateCcw } from 'lucide-react';
import { videoPlaybackStore } from '../../../services/video-playback-store';
import type { ResourceRecord } from '../../../types/inspection';
import { probeMedia } from '../../../utils/asset-explorer';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { MediaPlayerError } from './media-player-error';
import {
  getVideoErrorCopy,
  mapVideoMediaError,
  type VideoPlaybackFailureKind,
} from './media-player-utils';
import { useHlsPlayer } from './use-hls-player';
import { useMediaStage } from './use-media-stage';
import { useVideoContinuity } from './use-video-continuity';
import { useVideoKeyboardShortcuts } from './use-video-keyboard-shortcuts';
import { VideoPlayerControls } from './video-player-controls';
import { computeSeekTarget, computeSteppedVolume } from './video-shortcuts';

interface CustomVideoPlayerProps {
  inspectionId: string;
  resource: ResourceRecord;
  filename: string;
  isBookmarked?: boolean;
  canDownload: boolean;
  isDownloading: boolean;
  copied: boolean;
  controlsVisible?: boolean;
  totalItems?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onControlsPointerEnter?: () => void;
  onControlsPointerLeave?: () => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  onSpeedMenuOpenChange?: (open: boolean) => void;
  onErrorStateChange?: (hasError: boolean) => void;
  onRevealControls?: () => void;
  onDownload: () => void;
  onCopy: () => void;
}

export function CustomVideoPlayer({
  inspectionId,
  resource,
  filename,
  isBookmarked = false,
  canDownload,
  isDownloading,
  copied,
  controlsVisible = true,
  totalItems = 1,
  onPrev,
  onNext,
  onControlsPointerEnter,
  onControlsPointerLeave,
  onScrubbingChange,
  onSpeedMenuOpenChange,
  onErrorStateChange,
  onRevealControls,
  onDownload,
  onCopy,
}: CustomVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isScrubbingRef = useRef(false);
  const lastResourceIdRef = useRef(resource.id);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [failureKind, setFailureKind] = useState<VideoPlaybackFailureKind | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [probedMime, setProbedMime] = useState<string | undefined>(resource.mimeType);
  const [probedBytes, setProbedBytes] = useState<number | undefined>(resource.declaredBytes);
  const [durationHint, setDurationHint] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  const stage = useMediaStage(resource.id, failureKind !== null);

  const continuity = useVideoContinuity({
    resource,
    inspectionId,
    videoRef,
    isPlaying,
    isBookmarked,
    currentTime,
    duration,
    playbackRate,
    volume,
    isMuted,
    onSyncTime: setCurrentTime,
  });

  const { sourcePlan } = continuity;
  const isHls = sourcePlan.isHls;
  const activeSrc = isHls ? undefined : sourcePlan.activeSrc;
  const posterSrc = resource.posterUrl
    ? buildProxyAssetUrl(resource.posterUrl, inspectionId, resource.referer)
    : undefined;
  const effectiveMime = probedMime ?? resource.mimeType;
  const effectiveBytes = probedBytes ?? resource.declaredBytes;
  const hasError = failureKind !== null;
  const isEnded = !isPlaying && duration > 0 && currentTime >= duration - 0.12;

  useEffect(() => {
    onErrorStateChange?.(hasError);
  }, [hasError, onErrorStateChange]);

  useEffect(() => {
    if (lastResourceIdRef.current !== resource.id) {
      lastResourceIdRef.current = resource.id;
    }
    const snap = videoPlaybackStore.getSnapshot(continuity.smartCacheKey);
    setIsPlaying(false);
    setIsBuffering(true);
    setFailureKind(null);
    setRetryCount(0);
    setProbedMime(resource.mimeType);
    setProbedBytes(resource.declaredBytes);
    setDurationHint(null);
    setCurrentTime(snap?.currentTime ?? 0);
    setDuration(snap?.duration ?? 0);
    setBufferedEnd(0);
    setPlaybackRate(snap?.playbackRate ?? 1);
  }, [resource.id, resource.mimeType, resource.declaredBytes, continuity.smartCacheKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
    video.playbackRate = playbackRate;
    video.loop = isLooping;
  }, [activeSrc, retryCount, volume, isMuted, playbackRate, isLooping]);

  const hlsLoadUrl =
    isHls && sourcePlan.hlsSrc
      ? sourcePlan.hlsSrc.startsWith('/smartcache/')
        ? sourcePlan.hlsSrc
        : `${sourcePlan.hlsSrc}${sourcePlan.hlsSrc.includes('?') ? '&' : '?'}v=${retryCount}`
      : null;

  useHlsPlayer({
    videoRef,
    hlsUrl: hlsLoadUrl,
    enabled: isHls && failureKind === null,
    startPosition: continuity.initialResumeTime > 0 ? continuity.initialResumeTime : -1,
    autoStartLoad: true,
    onReady: () => setIsBuffering(false),
    onError: (kind) => {
      setFailureKind(kind);
      setIsBuffering(false);
    },
  });

  useEffect(() => {
    if (isHls || sourcePlan.isOfflineCached || (resource.mimeType && resource.declaredBytes)) return;
    let cancelled = false;
    void probeMedia(resource.url, inspectionId)
      .then((info) => {
        if (cancelled || !info.ok) return;
        if (info.contentType) setProbedMime(info.contentType.split(';')[0]?.trim());
        if (info.totalBytes > 0) setProbedBytes(info.totalBytes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inspectionId, isHls, resource.url, resource.mimeType, resource.declaredBytes, sourcePlan.isOfflineCached]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;
    if (video.paused || video.ended) {
      if (video.ended) {
        video.currentTime = 0;
        setCurrentTime(0);
      }
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [hasError]);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = computeSeekTarget(video.currentTime, video.duration, deltaSeconds);
      if (next === null) return;
      video.currentTime = next;
      setCurrentTime(next);
      continuity.flushPlaybackSnapshot({ currentTime: next }, { immediate: true });
    },
    [continuity],
  );

  const changeVolumeBy = useCallback(
    (delta: number) => {
      const next = computeSteppedVolume(volume, isMuted, delta);
      if (videoRef.current) {
        videoRef.current.volume = next.volume;
        videoRef.current.muted = next.isMuted;
      }
      setVolume(next.volume);
      setIsMuted(next.isMuted);
    },
    [isMuted, volume],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      video.volume = 0.5;
      setVolume(0.5);
    }
  }, [volume]);

  const handlePrevVideo = useCallback(() => {
    continuity.flushPlaybackSnapshot(undefined, { immediate: true });
    onPrev?.();
  }, [continuity, onPrev]);

  const handleNextVideo = useCallback(() => {
    continuity.flushPlaybackSnapshot(undefined, { immediate: true });
    onNext?.();
  }, [continuity, onNext]);

  useVideoKeyboardShortcuts({
    totalItems,
    canDownload,
    isDownloading,
    togglePlay,
    toggleMute,
    seekBy,
    changeVolumeBy,
    onPrev: handlePrevVideo,
    onNext: handleNextVideo,
    onDownload,
    onRevealControls,
    zoom: stage.zoom,
    applyZoom: stage.applyZoom,
    resetTransform: stage.resetTransform,
    rotate90: stage.rotate90,
    toggleFlipX: stage.toggleFlipX,
    toggleFlipY: stage.toggleFlipY,
  });

  if (failureKind !== null) {
    const errorCopy = getVideoErrorCopy(failureKind, effectiveMime, true);
    return (
      <MediaPlayerError
        icon={<Film size={28} aria-hidden="true" />}
        title={errorCopy.title}
        description={errorCopy.description}
        filename={filename}
        declaredBytes={effectiveBytes}
        canDownload={canDownload}
        isDownloading={isDownloading}
        copied={copied}
        onDownload={onDownload}
        onCopy={onCopy}
        onRetry={() => {
          setFailureKind(null);
          setIsBuffering(true);
          setRetryCount((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#09090b] text-white select-none">
      <div
        ref={stage.canvasRef}
        onWheel={(e) => stage.handleWheel(e.deltaY)}
        onPointerDown={stage.handlePointerDown}
        onPointerMove={stage.handlePointerMove}
        onPointerUp={stage.handlePointerUp}
        onPointerCancel={stage.handlePointerCancel}
        onClick={() => {
          if (stage.suppressNextClickRef.current) {
            stage.suppressNextClickRef.current = false;
            return;
          }
          if (!controlsVisible && stage.lastPointerTypeRef.current !== 'mouse') {
            onRevealControls?.();
            return;
          }
          togglePlay();
        }}
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#09090b] p-0 transition-colors duration-150 ${
          stage.zoom > 1
            ? stage.isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : !controlsVisible && isPlaying
              ? 'cursor-none'
              : 'cursor-pointer'
        }`}
      >
        <video
          ref={videoRef}
          key={`${isHls ? sourcePlan.hlsSrc : activeSrc}-${retryCount}`}
          src={activeSrc}
          poster={posterSrc}
          autoPlay
          loop={isLooping}
          playsInline
          preload="metadata"
          aria-label={`Pemutar video ${filename}`}
          onLoadStart={() => setIsBuffering(true)}
          onWaiting={() => setIsBuffering(true)}
          onLoadedData={() => setIsBuffering(false)}
          onCanPlay={(e) => {
            setIsBuffering(false);
            continuity.applyPendingResumeSeek(e.currentTarget);
          }}
          onCanPlayThrough={() => setIsBuffering(false)}
          onPlaying={(e) => {
            setIsPlaying(true);
            setIsBuffering(false);
            continuity.flushPlaybackSnapshot({
              currentTime: e.currentTarget.currentTime,
              wasPlaying: true,
            });
          }}
          onPause={(e) => {
            setIsPlaying(false);
            continuity.flushPlaybackSnapshot(
              {
                currentTime: e.currentTarget.currentTime,
                wasPlaying: false,
              },
              { immediate: true },
            );
          }}
          onSeeked={(e) => {
            continuity.flushPlaybackSnapshot(
              {
                currentTime: e.currentTarget.currentTime,
                wasPlaying: !e.currentTarget.paused && !e.currentTarget.ended,
              },
              { immediate: true },
            );
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
              setCurrentTime(videoRef.current.duration);
              continuity.flushPlaybackSnapshot(
                { currentTime: videoRef.current.duration, wasPlaying: false },
                { immediate: true },
              );
            }
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.volume = volume;
            v.muted = isMuted;
            v.playbackRate = playbackRate;
            v.loop = isLooping;
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              stage.setNaturalSize({ width: v.videoWidth, height: v.videoHeight });
            }
            if (Number.isFinite(v.duration) && v.duration > 0) {
              setDuration(v.duration);
              setDurationHint(null);
            } else {
              setDuration(0);
              setDurationHint('Durasi video belum terbaca dari sumber.');
            }
            continuity.applyPendingResumeSeek(v);
            setIsBuffering(false);
          }}
          onResize={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              stage.setNaturalSize({ width: v.videoWidth, height: v.videoHeight });
            }
          }}
          onDurationChange={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              setDuration(v.duration);
              setDurationHint(null);
              continuity.applyPendingResumeSeek(v);
            }
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (!isScrubbingRef.current) {
              setCurrentTime(v.currentTime);
            }
            if (!v.paused && !v.ended) {
              continuity.flushThrottledTime(
                v.currentTime,
                Number.isFinite(v.duration) ? v.duration : 0,
              );
            }
            if (v.buffered.length > 0) {
              setBufferedEnd(v.buffered.end(v.buffered.length - 1));
            }
          }}
          onProgress={(e) => {
            const v = e.currentTarget;
            if (v.buffered.length > 0) {
              setBufferedEnd(v.buffered.end(v.buffered.length - 1));
            }
          }}
          onError={(e) => {
            if (isHls) return;
            const kind = mapVideoMediaError(e.currentTarget.error?.code);
            setFailureKind(kind);
            setIsBuffering(false);
          }}
          style={{
            ...(stage.fittedDimensions
              ? {
                  width: `${stage.fittedDimensions.width}px`,
                  height: `${stage.fittedDimensions.height}px`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }
              : {}),
            transform: `translate3d(${stage.pan.x}px, ${stage.pan.y}px, 0) scale(${stage.flipX ? -stage.zoom : stage.zoom}, ${stage.flipY ? -stage.zoom : stage.zoom}) rotate(${stage.rotation}deg)`,
          }}
          className={`${
            stage.fittedDimensions
              ? 'shrink-0 object-contain'
              : 'h-full w-full bg-black object-contain'
          } shadow-lg ${
            stage.isDragging
              ? 'transition-none'
              : 'transition-transform duration-150 ease-out'
          }`}
        />

        {!isPlaying && !isBuffering ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-amber)]/45 bg-[#121215]/90 text-white shadow-xl backdrop-blur-sm transition-transform duration-150">
              {isEnded ? (
                <RotateCcw size={25} aria-hidden="true" />
              ) : (
                <Play size={26} aria-hidden="true" className="translate-x-0.5 fill-current" />
              )}
            </span>
          </div>
        ) : null}

        {isBuffering ? (
          <div
            aria-label="Memuat video"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-amber)]" />
          </div>
        ) : null}
      </div>

      <div
        onPointerEnter={onControlsPointerEnter}
        onPointerLeave={onControlsPointerLeave}
        onFocusCapture={onRevealControls}
        className={`absolute inset-x-0 bottom-0 z-30 transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
          controlsVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        <VideoPlayerControls
          isPlaying={isPlaying}
          isEnded={isEnded}
          isMuted={isMuted}
          isLooping={isLooping}
          volume={volume}
          currentTime={currentTime}
          duration={duration}
          bufferedEnd={bufferedEnd}
          zoom={stage.zoom}
          rotation={stage.rotation}
          flipX={stage.flipX}
          flipY={stage.flipY}
          playbackRate={playbackRate}
          durationHint={durationHint}
          totalItems={totalItems}
          onPrev={handlePrevVideo}
          onNext={handleNextVideo}
          onTogglePlay={togglePlay}
          onScrubStart={() => {
            isScrubbingRef.current = true;
            onScrubbingChange?.(true);
          }}
          onScrubEnd={() => {
            isScrubbingRef.current = false;
            onScrubbingChange?.(false);
          }}
          onSeekTo={(nextTime) => {
            if (videoRef.current) {
              videoRef.current.currentTime = nextTime;
            }
            setCurrentTime(nextTime);
            continuity.flushPlaybackSnapshot({ currentTime: nextTime }, { immediate: true });
          }}
          onSeekBy={seekBy}
          onToggleMute={toggleMute}
          onToggleLoop={() => setIsLooping((prev) => !prev)}
          onChangeVolume={(nextVol) => {
            if (videoRef.current) {
              videoRef.current.volume = nextVol;
              videoRef.current.muted = nextVol === 0;
            }
            setVolume(nextVol);
            setIsMuted(nextVol === 0);
          }}
          onApplyZoom={stage.applyZoom}
          onResetZoom={stage.resetTransform}
          onRotate={stage.rotate90}
          onToggleFlipX={stage.toggleFlipX}
          onToggleFlipY={stage.toggleFlipY}
          onChangeSpeed={(nextSpeed) => {
            if (videoRef.current) {
              videoRef.current.playbackRate = nextSpeed;
            }
            setPlaybackRate(nextSpeed);
            continuity.flushPlaybackSnapshot({ playbackRate: nextSpeed }, { immediate: true });
          }}
          onSpeedMenuOpenChange={onSpeedMenuOpenChange}
        />
      </div>
    </div>
  );
}
