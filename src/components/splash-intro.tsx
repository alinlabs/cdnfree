import { useCallback, useEffect, useRef, useState } from 'react';

interface SplashIntroProps {
  onComplete: () => void;
}

const SPLASH_HOLD_MS = 1400;
const FADE_OUT_MS = 280;

export function SplashIntro({ onComplete }: SplashIntroProps) {
  const completedRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const finishSplash = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setIsFadingOut(true);
    finishTimerRef.current = window.setTimeout(() => {
      onComplete();
    }, FADE_OUT_MS);
  }, [onComplete]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    holdTimerRef.current = window.setTimeout(() => {
      finishSplash();
    }, SPLASH_HOLD_MS);

    return () => {
      window.cancelAnimationFrame(frame);
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
      if (finishTimerRef.current !== null) {
        window.clearTimeout(finishTimerRef.current);
      }
    };
  }, [finishSplash]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Splash screen CDN FREE"
      onClick={finishSplash}
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#FD9802] px-6 select-none transition-opacity duration-300 motion-reduce:transition-none dark:bg-[var(--color-bg)] ${
        isFadingOut ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div
        className={`flex items-center gap-3.5 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none sm:gap-4 ${
          isVisible && !isFadingOut
            ? 'translate-y-0 scale-100 opacity-100'
            : 'translate-y-1 scale-95 opacity-0'
        }`}
      >
        <img
          src="/logo.webp"
          alt="Logo CDN FREE"
          className="h-14 w-14 shrink-0 object-contain dark:rounded-[var(--radius-lg)] sm:h-18 sm:w-18"
        />
        <span className="text-3xl font-bold tracking-[-0.025em] text-white whitespace-nowrap sm:text-4xl">
          CDN FREE
        </span>
      </div>
    </div>
  );
}
