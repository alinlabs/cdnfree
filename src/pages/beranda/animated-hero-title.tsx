import { useEffect, useState } from 'react';
import { BrandWordmark } from '../../components/brand-wordmark';

type HeroSlide = 'logo' | 'tagline';

const INITIAL_BLANK_MS = 280;
const REVEAL_MS = 920;
const HOLD_LOGO_MS = 2500;
const HOLD_TAGLINE_MS = 3200;
const ERASE_MS = 760;
const PAUSE_BETWEEN_MS = 1000;

export function AnimatedHeroTitle() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [activeSlide, setActiveSlide] = useState<HeroSlide>('logo');
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };
    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => {
      mediaQuery.removeEventListener('change', updatePreference);
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setActiveSlide('tagline');
      setRevealed(true);
      return;
    }

    let cancelled = false;
    let timerId: number | undefined;
    let rafA: number | undefined;
    let rafB: number | undefined;

    const schedule = (delayMs: number, fn: () => void) => {
      timerId = window.setTimeout(() => {
        if (!cancelled) fn();
      }, delayMs);
    };

    const runCycle = (slide: HeroSlide, initialDelayMs: number) => {
      setActiveSlide(slide);
      setRevealed(false);

      schedule(initialDelayMs, () => {
        rafA = window.requestAnimationFrame(() => {
          rafB = window.requestAnimationFrame(() => {
            if (cancelled) return;
            setRevealed(true);

            const holdMs = slide === 'logo' ? HOLD_LOGO_MS : HOLD_TAGLINE_MS;
            schedule(REVEAL_MS + holdMs, () => {
              setRevealed(false);

              schedule(ERASE_MS + PAUSE_BETWEEN_MS, () => {
                const nextSlide: HeroSlide = slide === 'logo' ? 'tagline' : 'logo';
                runCycle(nextSlide, 0);
              });
            });
          });
        });
      });
    };

    runCycle('logo', INITIAL_BLANK_MS);

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (rafA !== undefined) window.cancelAnimationFrame(rafA);
      if (rafB !== undefined) window.cancelAnimationFrame(rafB);
    };
  }, [prefersReducedMotion]);

  return (
    <h1
      id="beranda-heading"
      aria-label="CDNFREE — Jelajahi tautan dengan lebih aman"
      className="flex h-11 w-full items-center justify-center overflow-hidden sm:h-12"
    >
      <span className="sr-only">CDNFREE — Jelajahi tautan dengan lebih aman</span>

      {activeSlide === 'logo' ? (
        <span
          key="logo"
          aria-hidden="true"
          data-state={revealed ? 'visible' : 'hidden'}
          className="cdnfree-paint-reveal inline-flex items-center justify-center px-1"
        >
          <BrandWordmark size="lg" asLink={false} />
        </span>
      ) : (
        <span
          key="tagline"
          aria-hidden="true"
          data-state={revealed ? 'visible' : 'hidden'}
          className="cdnfree-paint-reveal inline-block whitespace-nowrap px-1 text-[clamp(1.0625rem,4.3vw,2.25rem)] font-semibold leading-tight tracking-[-0.025em] text-[var(--color-text)]"
        >
          Jelajahi tautan dengan lebih aman
        </span>
      )}
    </h1>
  );
}
