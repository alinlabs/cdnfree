import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play } from 'lucide-react';
import type { ResourceRecord } from '../../../types/inspection';
import { probeMedia } from '../../../utils/asset-explorer';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { MediaPlayerError } from './media-player-error';
import {
  clampMediaPan,
  clampMediaZoom,
  getNextPlaybackSpeed,
  getVideoErrorCopy,
  mapVideoMediaError,
  MEDIA_WHEEL_ZOOM_STEP,
  MEDIA_ZOOM_STEP,
  stepMediaZoom,
  type MediaPanOffset,
  type VideoPlaybackFailureKind,
} from './media-player-utils';
import { VideoPlayerControls } from './video-player-controls';

interface CustomVideoPlayerProps {
  inspectionId: string;
  resource: ResourceRecord;
  filename: string;
  canDownload: boolean;
  isDownloading: boolean;
  copied: boolean;
  onDownload: () => void;
  onCopy: () => void;
}

export function CustomVideoPlayer({
  inspectionId,
  resource,
  filename,
  canDownload,
  isDownloading,
  copied,
  onDownload,
  onCopy,
}: CustomVideoPlayerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [failureKind, setFailureKind] = useState<VideoPlaybackFailureKind | null>(null);
  const [useDirectUrl, setUseDirectUrl] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [probedMime, setProbedMime] = useState<string | undefined>(resource.mimeType);
  const [probedBytes, setProbedBytes] = useState<number | undefined>(resource.declaredBytes);
  const [durationHint, setDurationHint] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<MediaPanOffset>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const proxySrc = buildProxyAssetUrl(resource.url, inspectionId);
  const activeSrc = useDirectUrl ? resource.url : proxySrc;
  const posterSrc = resource.posterUrl
    ? buildProxyAssetUrl(resource.posterUrl, inspectionId)
    : undefined;
  const effectiveMime = probedMime ?? resource.mimeType;
  const effectiveBytes = probedBytes ?? resource.declaredBytes;
  const hasError = failureKind !== null;

  useEffect(() => {
    setIsPlaying(false);
    setIsBuffering(true);
    setFailureKind(null);
    setUseDirectUrl(false);
    setRetryCount(0);
    setProbedMime(resource.mimeType);
    setProbedBytes(resource.declaredBytes);
    setDurationHint(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setPlaybackRate(1);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [resource.id, resource.mimeType, resource.declaredBytes]);

  useEffect(() => {
    if (resource.mimeType && resource.declaredBytes) return;
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

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      const rect = canvasRef.current?.getBoundingClientRect();
      setPan((prev) =>
        clampMediaPan(prev, zoom, {
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        }),
      );
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [zoom]);

  const applyZoom = useCallback((nextZoomRaw: number) => {
    const nextZoom = clampMediaZoom(nextZoomRaw);
    setZoom(nextZoom);
    const rect = canvasRef.current?.getBoundingClientRect();
    setPan((prev) =>
      clampMediaPan(prev, nextZoom, {
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      }),
    );
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;
    if (video.paused || video.ended) {
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

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch {
      // Ignore fullscreen denial
    }
  }, []);

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
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        seekBy(-10);
      } else if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        seekBy(10);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        applyZoom(stepMediaZoom(zoom, MEDIA_ZOOM_STEP));
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        applyZoom(stepMediaZoom(zoom, -MEDIA_ZOOM_STEP));
      } else if (event.key === '0') {
        event.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyZoom, resetZoom, seekBy, toggleFullscreen, toggleMute, togglePlay, zoom]);

  if (failureKind !== null) {
    const errorCopy = getVideoErrorCopy(failureKind, effectiveMime, useDirectUrl);
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
          !useDirectUrl && (failureKind === 'src' || failureKind === 'network' || failureKind === 'unknown')
            ? () => {
                setFailureKind(null);
                setIsBuffering(true);
                setUseDirectUrl(true);
              }
            : undefined
        }
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
    <div
      ref={stageRef}
      className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-bg)] select-none"
    >
      <div
        ref={canvasRef}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) < 4) return;
          const step = e.deltaY < 0 ? MEDIA_WHEEL_ZOOM_STEP : -MEDIA_WHEEL_ZOOM_STEP;
          applyZoom(zoom + step);
        }}
        onPointerDown={(e) => {
          if (zoom <= 1 || e.button !== 0) return;
          dragStateRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: pan.x,
            originY: pan.y,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragStateRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          const dx = e.clientX - drag.startX;
          const dy = e.clientY - drag.startY;
          if (!drag.moved && Math.hypot(dx, dy) > 4) {
            drag.moved = true;
            setIsDragging(true);
          }
          if (drag.moved) {
            const rect = canvasRef.current?.getBoundingClientRect();
            setPan(
              clampMediaPan(
                { x: drag.originX + dx, y: drag.originY + dy },
                zoom,
                { width: rect?.width ?? 0, height: rect?.height ?? 0 },
              ),
            );
          }
        }}
        onPointerUp={(e) => {
          const drag = dragStateRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          if (drag.moved) {
            suppressNextClickRef.current = true;
          }
          dragStateRef.current = null;
          setIsDragging(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragStateRef.current = null;
          setIsDragging(false);
        }}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          togglePlay();
        }}
        onDoubleClick={() => {
          void toggleFullscreen();
        }}
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden transition-colors duration-150 ${
          isFullscreen
            ? 'bg-[#111113] p-2 sm:p-4'
            : 'bg-[var(--color-surface-subtle)] p-3 sm:p-6'
        } ${
          zoom > 1
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-pointer'
        }`}
      >
        <video
          ref={videoRef}
          key={`${activeSrc}-${retryCount}`}
          src={activeSrc}
          poster={posterSrc}
          autoPlay
          playsInline
          preload="metadata"
          aria-label={`Pemutar video ${filename}`}
          onLoadStart={() => setIsBuffering(true)}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          onPlaying={() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              setDuration(v.duration);
              setDurationHint(null);
            } else {
              setDuration(0);
              setDurationHint('Durasi belum terbaca — coba geser atau putar langsung.');
            }
            setIsBuffering(false);
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
            setCurrentTime(v.currentTime);
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
            const kind = mapVideoMediaError(e.currentTarget.error?.code);
            if (!useDirectUrl && kind !== 'decode') {
              setIsBuffering(true);
              setUseDirectUrl(true);
              return;
            }
            setFailureKind(kind);
            setIsBuffering(false);
          }}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
          className={`max-h-full max-w-full bg-black object-contain ${
            isDragging
              ? 'transition-none'
              : 'transition-transform duration-150 ease-out'
          } ${
            isFullscreen
              ? ''
              : 'rounded-[var(--radius-md)] border border-[var(--color-border)] shadow-sm'
          }`}
        />

        {!isPlaying && !isBuffering ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text)] shadow-lg">
              <Play size={26} aria-hidden="true" className="translate-x-0.5 fill-current" />
            </span>
          </div>
        ) : null}

        {isBuffering ? (
          <div
            aria-label="Memuat video"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-amber)]" />
          </div>
        ) : null}
      </div>

      <VideoPlayerControls
        isPlaying={isPlaying}
        isMuted={isMuted}
        volume={volume}
        currentTime={currentTime}
        duration={duration}
        bufferedEnd={bufferedEnd}
        zoom={zoom}
        playbackRate={playbackRate}
        isFullscreen={isFullscreen}
        durationHint={durationHint}
        useDirectUrl={useDirectUrl}
        onTogglePlay={togglePlay}
        onSeekTo={(nextTime) => {
          if (videoRef.current) {
            videoRef.current.currentTime = nextTime;
          }
          setCurrentTime(nextTime);
        }}
        onSeekBy={seekBy}
        onToggleMute={toggleMute}
        onChangeVolume={(nextVol) => {
          if (videoRef.current) {
            videoRef.current.volume = nextVol;
            videoRef.current.muted = nextVol === 0;
          }
          setVolume(nextVol);
          setIsMuted(nextVol === 0);
        }}
        onApplyZoom={applyZoom}
        onResetZoom={resetZoom}
        onCycleSpeed={() => {
          const nextSpeed = getNextPlaybackSpeed(playbackRate);
          if (videoRef.current) {
            videoRef.current.playbackRate = nextSpeed;
          }
          setPlaybackRate(nextSpeed);
        }}
        onToggleFullscreen={() => {
          void toggleFullscreen();
        }}
        onPlayDirect={() => {
          setIsBuffering(true);
          setUseDirectUrl(true);
        }}
      />
    </div>
  );
}
