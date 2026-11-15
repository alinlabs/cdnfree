import { useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import {
  formatPlaybackSpeed,
  PLAYBACK_SPEED_OPTIONS,
} from './media-player-utils';

interface VideoSpeedControlProps {
  playbackRate: number;
  subtleBtnClass: string;
  onChangeSpeed: (speed: number) => void;
  onSpeedMenuOpenChange?: (open: boolean) => void;
}

export function VideoSpeedControl({
  playbackRate,
  subtleBtnClass,
  onChangeSpeed,
  onSpeedMenuOpenChange,
}: VideoSpeedControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardBridgeRef = useRef<HTMLDivElement>(null);
  const lastInputTouchRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isTouchOpen, setIsTouchOpen] = useState(false);

  const isFloatingOpen = isHovered || isTouchOpen;

  const isPointInRect = (
    rect: DOMRect | undefined,
    clientX: number,
    clientY: number,
  ) =>
    Boolean(
      rect &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
    );

  const isPointInsideUi = (clientX: number, clientY: number): boolean =>
    isPointInRect(buttonRef.current?.getBoundingClientRect(), clientX, clientY) ||
    isPointInRect(cardBridgeRef.current?.getBoundingClientRect(), clientX, clientY);

  useEffect(() => {
    onSpeedMenuOpenChange?.(isFloatingOpen);
  }, [isFloatingOpen, onSpeedMenuOpenChange]);

  useEffect(() => {
    if (!isTouchOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!isPointInsideUi(event.clientX, event.clientY)) {
        setIsTouchOpen(false);
        setIsHovered(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsTouchOpen(false);
        setIsHovered(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isTouchOpen]);

  return (
    <div
      onPointerDown={(e) => {
        lastInputTouchRef.current = e.pointerType !== 'mouse';
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          lastInputTouchRef.current = false;
          setIsHovered(true);
        }
      }}
      onMouseEnter={() => {
        if (!lastInputTouchRef.current) {
          setIsHovered(true);
        }
      }}
      onMouseLeave={(e) => {
        if (!isPointInsideUi(e.clientX, e.clientY)) {
          setIsHovered(false);
        }
      }}
      className="relative flex items-center"
    >
      <div
        ref={cardBridgeRef}
        className={`absolute right-0 bottom-full z-40 pb-2 transition-[opacity,transform] duration-150 ${
          isFloatingOpen
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <div
          role="menu"
          aria-label="Pilihan kecepatan putar"
          className="flex min-w-[72px] flex-col gap-0.5 rounded-[var(--radius-md)] border border-white/15 bg-[#121216]/95 p-1.5 shadow-xl backdrop-blur-sm"
        >
          {PLAYBACK_SPEED_OPTIONS.map((rate) => {
            const isSelected = Math.abs(playbackRate - rate) < 0.001;
            return (
              <button
                key={rate}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChangeSpeed(rate);
                  if (isTouchOpen) {
                    setIsTouchOpen(false);
                  }
                }}
                className={`flex h-7 w-full items-center justify-center rounded-[6px] px-2.5 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                  isSelected
                    ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                {formatPlaybackSpeed(rate)}
              </button>
            );
          })}
        </div>
      </div>

      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          if (lastInputTouchRef.current || e.detail === 0) {
            setIsTouchOpen((prev) => !prev);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={isFloatingOpen}
        aria-label={`Kecepatan putar ${formatPlaybackSpeed(playbackRate)}x`}
        title={`Kecepatan putar (${formatPlaybackSpeed(playbackRate)}x)`}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
          playbackRate !== 1 || isFloatingOpen
            ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
            : subtleBtnClass
        }`}
      >
        <Gauge size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
