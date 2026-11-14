import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Volume2, VolumeX } from 'lucide-react';
import introVideoUrl from '../assets/into-landscape.mp4';

interface SplashIntroProps {
  onComplete: () => void;
}

const FADE_OUT_MS = 280;

export function SplashIntro({ onComplete }: SplashIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const maxAllowedTimeRef = useRef(0);
  const completedRef = useRef(false);
  const finishTimerRef = useRef<number | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [needsUserStart, setNeedsUserStart] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const finishSplash = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsFadingOut(true);
    finishTimerRef.current = window.setTimeout(() => {
      onComplete();
    }, FADE_OUT_MS);
  }, [onComplete]);

  const enforcePlaybackRate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.defaultPlaybackRate !== 1) {
      video.defaultPlaybackRate = 1;
    }
    if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }
  }, []);

  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    enforcePlaybackRate();
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          setNeedsUserStart(false);
        })
        .catch(() => {
          setNeedsUserStart(true);
        });
    }
  }, [enforcePlaybackRate]);

  useEffect(() => {
    attemptPlay();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !completedRef.current) {
        attemptPlay();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isControlBtn = target?.dataset?.splashControl === 'true';
      if (isControlBtn && (event.key === 'Enter' || event.key === ' ')) {
        return;
      }

      const blockedKeys = new Set([
        ' ',
        'Spacebar',
        'Enter',
        'Escape',
        'Tab',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'k',
        'K',
        'l',
        'L',
        'j',
        'J',
        'f',
        'F',
        'm',
        'M',
        '>',
        '<',
        '.',
        ',',
        'MediaPlayPause',
        'MediaTrackNext',
        'MediaFastForward',
        'MediaStop',
      ]);

      if (blockedKeys.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      if (finishTimerRef.current !== null) {
        window.clearTimeout(finishTimerRef.current);
      }
    };
  }, [attemptPlay]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    enforcePlaybackRate();

    const delta = video.currentTime - maxAllowedTimeRef.current;
    if (delta > 0.75) {
      video.currentTime = maxAllowedTimeRef.current;
      return;
    }

    if (video.currentTime > maxAllowedTimeRef.current) {
      maxAllowedTimeRef.current = video.currentTime;
    }
  };

  const handleSeeking = () => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    if (video.currentTime > maxAllowedTimeRef.current + 0.25) {
      video.currentTime = maxAllowedTimeRef.current;
    }
  };

  const handlePause = () => {
    const video = videoRef.current;
    if (!video || completedRef.current || video.ended) return;
    if (document.visibilityState === 'visible') {
      attemptPlay();
    }
  };

  const handleEnded = () => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 1.5 && maxAllowedTimeRef.current < duration - 1.25) {
      video.currentTime = maxAllowedTimeRef.current;
      attemptPlay();
      return;
    }

    finishSplash();
  };

  const handleToggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    if (video.paused && !completedRef.current) {
      attemptPlay();
    }
  };

  const handleManualStart = () => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    video.muted = isMuted;
    attemptPlay();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video intro CDNFREE"
      onContextMenu={(event) => event.preventDefault()}
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black select-none transition-opacity duration-300 ${
        isFadingOut ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <video
        ref={videoRef}
        src={introVideoUrl}
        autoPlay
        muted={isMuted}
        playsInline
        preload="auto"
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(event) => event.preventDefault()}
        onLoadedMetadata={enforcePlaybackRate}
        onPlay={enforcePlaybackRate}
        onPlaying={() => {
          enforcePlaybackRate();
          setNeedsUserStart(false);
        }}
        onRateChange={enforcePlaybackRate}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={finishSplash}
        className="pointer-events-none h-full w-full select-none object-contain landscape:object-cover"
      />

      {needsUserStart ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6">
          <button
            type="button"
            data-splash-control="true"
            onClick={handleManualStart}
            className="inline-flex min-h-[48px] items-center gap-2.5 rounded-[var(--radius-md)] bg-[var(--color-amber)] px-6 py-3 text-sm font-semibold text-[var(--color-on-amber)] shadow-lg transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
          >
            <Play size={17} aria-hidden="true" className="fill-current" />
            <span>Putar intro untuk masuk</span>
          </button>
        </div>
      ) : null}

      <button
        type="button"
        data-splash-control="true"
        onClick={handleToggleSound}
        aria-label={isMuted ? 'Aktifkan suara intro' : 'Bisukan suara intro'}
        title={isMuted ? 'Aktifkan suara' : 'Bisukan suara'}
        className="absolute right-4 bottom-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/85 backdrop-blur-sm transition-colors duration-150 hover:border-white/30 hover:bg-black/75 hover:text-white"
      >
        {isMuted ? (
          <VolumeX size={18} aria-hidden="true" />
        ) : (
          <Volume2 size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
