import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play, RotateCcw } from 'lucide-react';
import type { ResourceRecord } from '../../../types/inspection';
import { probeMedia } from '../../../utils/asset-explorer';
import {
  buildProxyAssetUrl,
  isHlsResource,
  resolveInlineStreamUrl,
} from '../../../utils/proxy-url';
import { MediaPlayerError } from './media-player-error';
import {
  getVideoErrorCopy,
  mapVideoMediaError,
  MEDIA_ZOOM_STEP,
  stepMediaZoom,
  type VideoPlaybackFailureKind,
} from './media-player-utils';
import { useHlsPlayer } from './use-hls-player';
import { useMediaStage } from './use-media-stage';
import { VideoPlayerControls } from './video-player-controls';

interface CustomVideoPlayerProps {
  inspectionId: string;
  resource: ResourceRecord;
  filename: string;
  allowArrowSeek?: boolean;
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
  allowArrowSeek = false,
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
  const autoFallbackTriedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [failureKind, setFailureKind] = useState<VideoPlaybackFailureKind | null>(null);
  const [useStreamFallback, setUseStreamFallback] = useState(false);
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

  const streamSrc = resolveInlineStreamUrl(resource, inspectionId);
  const isHls = isHlsResource(resource) && streamSrc.startsWith('/api/hls/');
  const activeSrc = isHls ? undefined : useStreamFallback ? streamSrc : resource.url;
  const posterSrc = resource.posterUrl
    ? buildProxyAssetUrl(resource.posterUrl, inspectionId)
    : undefined;
  const effectiveMime = probedMime ?? resource.mimeType;
  const effectiveBytes = probedBytes ?? resource.declaredBytes;
  const hasError = failureKind !== null;
  const isEnded = !isPlaying && duration > 0 && currentTime >= duration - 0.12;

  useEffect(() => {
    onErrorStateChange?.(hasError);
  }, [hasError, onErrorStateChange]);

  useEffect(() => {
    autoFallbackTriedRef.current = false;
    setIsPlaying(false);
    setIsBuffering(true);
    setFailureKind(null);
    setUseStreamFallback(false);
    setRetryCount(0);
    setProbedMime(resource.mimeType);
    setProbedBytes(resource.declaredBytes);
    setDurationHint(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setPlaybackRate(1);
  }, [resource.id, resource.mimeType, resource.declaredBytes]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
    video.playbackRate = playbackRate;
    video.loop = isLooping;
  }, [activeSrc, retryCount, volume, isMuted, playbackRate, isLooping]);

  useHlsPlayer({
    videoRef,
    hlsUrl: isHls ? `${streamSrc}?v=${retryCount}` : null,
    enabled: isHls && failureKind === null,
    onReady: () => setIsBuffering(false),
    onError: (kind) => {
      setFailureKind(kind);
      setIsBuffering(false);
    },
  });

  useEffect(() => {
    if (isHls || (resource.mimeType && resource.declaredBytes)) return;
    let cancelled = false;
    void probeMedia(resource.url, inspectionId)
      .then((info) => {
        if (cancelled || !info.ok) return;
        if (info.contentType) setProbedMime(info.contentType.split(';')[0]?.trim());
        if (info.totalBytes > 0) setProbedBytes(info.totalBytes);
      })
      .catch(() => {
        // Ignore non-fatal probe errors
      });
    return () => {
      cancelled = true;
    };
  }, [inspectionId, resource.url, resource.mimeType, resource.declaredBytes]);



  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;
    if (video.paused || video.ended) {
      if (video.ended) {
        video.currentTime = 0;
        setCurrentTime(0);
      }
      void video.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      video.pause();
    }
  }, [hasError]);

  const seekBy = useCallback((deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const next = Math.min(Math.max(0, video.currentTime + deltaSeconds), video.duration);
    video.currentTime = next;
    setCurrentTime(next);
  }, []);

  const changeVolumeBy = useCallback((delta: number) => {
    setVolume((prev) => {
      const next = Math.min(1, Math.max(0, Number((prev + delta).toFixed(2))));
      const nextMuted = next === 0;
      if (videoRef.current) {
        videoRef.current.volume = next;
        videoRef.current.muted = nextMuted;
      }
      setIsMuted(nextMuted);
      return next;
    });
  }, []);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlay();
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleMute();
      } else if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        seekBy(-10);
      } else if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        seekBy(10);
      } else if (allowArrowSeek && event.key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(-5);
      } else if (allowArrowSeek && event.key === 'ArrowRight') {
        event.preventDefault();
        seekBy(5);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        changeVolumeBy(0.1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        changeVolumeBy(-0.1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        stage.applyZoom(stepMediaZoom(stage.zoom, MEDIA_ZOOM_STEP));
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        stage.applyZoom(stepMediaZoom(stage.zoom, -MEDIA_ZOOM_STEP));
      } else if (event.key === '0') {
        event.preventDefault();
        stage.resetTransform();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        stage.rotate90();
      } else if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        stage.toggleFlipX();
      } else if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        stage.toggleFlipY();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    allowArrowSeek,
    changeVolumeBy,
    seekBy,
    stage,
    toggleMute,
    togglePlay,
  ]);

  if (failureKind !== null) {
    const isDirectActive = !useStreamFallback;
    const errorCopy = getVideoErrorCopy(failureKind, effectiveMime, isDirectActive);
    const canOfferDirectSwitch =
      useStreamFallback &&
      (failureKind === 'src' || failureKind === 'network' || failureKind === 'unknown');
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
        onPlayDirect={
          canOfferDirectSwitch
            ? () => {
                setFailureKind(null);
                setIsBuffering(true);
                setUseStreamFallback(false);
              }
            : undefined
        }
        playDirectLabel="Putar langsung"
        onRetry={
          failureKind === 'network'
            ? () => {
                setFailureKind(null);
                setIsBuffering(true);
                setRetryCount((n) => n + 1);
              }
            : undefined
        }
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
          key={`${isHls ? streamSrc : activeSrc}-${retryCount}`}
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
          onCanPlay={() => setIsBuffering(false)}
          onCanPlayThrough={() => setIsBuffering(false)}
          onPlaying={() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
              setCurrentTime(videoRef.current.duration);
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
              setDurationHint('Durasi belum terbaca — coba geser atau putar langsung.');
            }
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
            }
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (!isScrubbingRef.current) {
              setCurrentTime(v.currentTime);
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
            if (!useStreamFallback && !autoFallbackTriedRef.current && kind !== 'decode') {
              autoFallbackTriedRef.current = true;
              setIsBuffering(true);
              setUseStreamFallback(true);
              return;
            }
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
          useDirectUrl={!useStreamFallback}
          totalItems={totalItems}
          onPrev={() => onPrev?.()}
          onNext={() => onNext?.()}
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
          }}
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
          }}
          onSpeedMenuOpenChange={onSpeedMenuOpenChange}
          onPlayDirect={() => {
            setIsBuffering(true);
            setUseStreamFallback((prev) => !prev);
          }}
        />
      </div>
    </div>
  );
}
