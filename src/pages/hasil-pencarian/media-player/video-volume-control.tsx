import { useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface VideoVolumeControlProps {
  isMuted: boolean;
  volume: number;
  subtleBtnClass: string;
  onToggleMute: () => void;
  onChangeVolume: (vol: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}

export function VideoVolumeControl({
  isMuted,
  volume,
  subtleBtnClass,
  onToggleMute,
  onChangeVolume,
  onScrubStart,
  onScrubEnd,
}: VideoVolumeControlProps) {
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const volumeCardBridgeRef = useRef<HTMLDivElement>(null);
  const volumeTrackRef = useRef<HTMLDivElement>(null);
  const isDraggingVolumeRef = useRef(false);
  const lastInputTouchRef = useRef(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);

  const isVolumeFloatingOpen = isVolumeHovered || isDraggingVolume;
  const effectiveVolume = isMuted ? 0 : volume;
  const effectiveVolumePct = Math.round(
    Math.min(1, Math.max(0, effectiveVolume)) * 100,
  );

  const isPointInRect = (rect: DOMRect | undefined, clientX: number, clientY: number) =>
    Boolean(
      rect &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
    );

  const isPointInsideVolumeUi = (clientX: number, clientY: number): boolean =>
    isPointInRect(volumeButtonRef.current?.getBoundingClientRect(), clientX, clientY) ||
    isPointInRect(volumeCardBridgeRef.current?.getBoundingClientRect(), clientX, clientY);

  const updateVolumeFromClientY = (clientY: number) => {
    const rect = volumeTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const ratio = Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height));
    onChangeVolume(Number(ratio.toFixed(2)));
  };

  return (
    <div
      onPointerDown={(e) => {
        lastInputTouchRef.current = e.pointerType !== 'mouse';
      }}
      onMouseEnter={() => {
        if (!lastInputTouchRef.current) {
          setIsVolumeHovered(true);
        }
      }}
      onMouseLeave={(e) => {
        if (
          !isDraggingVolumeRef.current &&
          !isPointInsideVolumeUi(e.clientX, e.clientY)
        ) {
          setIsVolumeHovered(false);
        }
      }}
      className="relative flex items-center"
    >
      <div
        ref={volumeCardBridgeRef}
        className={`absolute bottom-full left-1/2 z-40 -translate-x-1/2 pb-2 transition-[opacity,transform] duration-150 ${
          isVolumeFloatingOpen
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-white/15 bg-[#121216]/95 px-2.5 py-2.5 shadow-xl backdrop-blur-sm">
          <span className="text-[10px] font-semibold text-white/80 tabular-nums">
            {effectiveVolumePct}%
          </span>
          <div
            ref={volumeTrackRef}
            role="slider"
            tabIndex={0}
            aria-label="Volume audio"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={effectiveVolumePct}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              isDraggingVolumeRef.current = true;
              setIsDraggingVolume(true);
              onScrubStart();
              if (e.pointerType === 'mouse') {
                setIsVolumeHovered(true);
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              updateVolumeFromClientY(e.clientY);
            }}
            onPointerMove={(e) => {
              if (!isDraggingVolumeRef.current) return;
              updateVolumeFromClientY(e.clientY);
            }}
            onPointerUp={(e) => {
              if (!isDraggingVolumeRef.current) return;
              isDraggingVolumeRef.current = false;
              setIsDraggingVolume(false);
              onScrubEnd();
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
              if (e.pointerType === 'mouse') {
                setIsVolumeHovered(isPointInsideVolumeUi(e.clientX, e.clientY));
              } else {
                setIsVolumeHovered(false);
              }
            }}
            onPointerCancel={() => {
              isDraggingVolumeRef.current = false;
              setIsDraggingVolume(false);
              onScrubEnd();
              setIsVolumeHovered(false);
            }}
            onWheel={(e) => {
              e.stopPropagation();
              if (Math.abs(e.deltaY) < 2) return;
              const delta = e.deltaY < 0 ? 0.05 : -0.05;
              onChangeVolume(
                Math.min(1, Math.max(0, Number((effectiveVolume + delta).toFixed(2)))),
              );
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                onChangeVolume(Math.min(1, Number((effectiveVolume + 0.05).toFixed(2))));
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                onChangeVolume(Math.max(0, Number((effectiveVolume - 0.05).toFixed(2))));
              }
            }}
            className="relative flex h-24 w-6 cursor-pointer touch-none items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--color-amber)]"
          >
            <div className="relative h-full w-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                style={{ height: `${effectiveVolumePct}%` }}
                className="absolute inset-x-0 bottom-0 rounded-full bg-[var(--color-amber)]"
              />
            </div>
            <span
              aria-hidden="true"
              style={{ bottom: `calc(${effectiveVolumePct}% - 6px)` }}
              className="pointer-events-none absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-[var(--color-amber-strong)] ring-2 ring-[#121216] shadow-sm"
            />
          </div>
        </div>
      </div>

      <button
        ref={volumeButtonRef}
        type="button"
        onClick={onToggleMute}
        aria-label={isMuted || volume === 0 ? 'Bunyikan audio' : 'Bisukan audio'}
        title={isMuted || volume === 0 ? 'Bunyikan (M)' : 'Bisukan (M)'}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 sm:h-9 sm:w-9 ${subtleBtnClass}`}
      >
        {isMuted || volume === 0 ? (
          <VolumeX size={17} aria-hidden="true" />
        ) : (
          <Volume2 size={17} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
