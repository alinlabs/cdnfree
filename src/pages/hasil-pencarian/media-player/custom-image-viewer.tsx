import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlipHorizontal2,
  FlipVertical2,
  ImageOff,
  Moon,
  RotateCw,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { PageContainer } from '../../../components/page-container';
import { useResilientImage } from '../../../hooks/use-resilient-image';
import type { ResourceRecord } from '../../../types/inspection';
import { MediaPlayerError } from './media-player-error';
import {
  clampMediaZoom,
  MEDIA_MAX_ZOOM,
  MEDIA_MIN_ZOOM,
  MEDIA_WHEEL_ZOOM_STEP,
  MEDIA_ZOOM_STEP,
  stepMediaZoom,
  type MediaPanOffset,
} from './media-player-utils';

interface CustomImageViewerProps {
  inspectionId: string;
  resource: ResourceRecord;
  filename: string;
  canDownload: boolean;
  isDownloading: boolean;
  copied: boolean;
  controlsVisible?: boolean;
  onControlsPointerEnter?: () => void;
  onControlsPointerLeave?: () => void;
  onErrorStateChange?: (hasError: boolean) => void;
  onRevealControls?: () => void;
  onDownload: () => void;
  onCopy: () => void;
}

export function CustomImageViewer({
  inspectionId,
  resource,
  filename,
  canDownload,
  isDownloading,
  copied,
  controlsVisible = true,
  onControlsPointerEnter,
  onControlsPointerLeave,
  onErrorStateChange,
  onRevealControls,
  onDownload,
  onCopy,
}: CustomImageViewerProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const lastPointerTypeRef = useRef<string>('mouse');

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<MediaPanOffset>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [useLightBackdrop, setUseLightBackdrop] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const { activeSrc, hasExhausted, advanceFallback } = useResilientImage(
    resource,
    inspectionId,
  );
  const hasError = hasExhausted || !activeSrc;

  useEffect(() => {
    onErrorStateChange?.(hasError);
  }, [hasError, onErrorStateChange]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setNaturalSize(null);
  }, [resource.id, resource.url]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;

    let rafId: number | null = null;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setCanvasSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 &&
        Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    const scheduleUpdate = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateSize();
      });
    };

    updateSize();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(scheduleUpdate);
      observer.observe(node);
      return () => {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        observer.disconnect();
      };
    }

    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [hasError]);

  const clampImagePan = useCallback(
    (
      nextPan: MediaPanOffset,
      nextZoom: number,
      bounds: { width: number; height: number },
    ): MediaPanOffset => {
      if (bounds.width <= 0 || bounds.height <= 0) {
        return nextPan;
      }
      const minReachX = bounds.width * 0.45;
      const minReachY = bounds.height * 0.45;
      const maxX =
        nextZoom > 1
          ? Math.max(minReachX, ((nextZoom - 1) * bounds.width) / 2)
          : minReachX;
      const maxY =
        nextZoom > 1
          ? Math.max(minReachY, ((nextZoom - 1) * bounds.height) / 2)
          : minReachY;
      return {
        x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
        y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
      };
    },
    [],
  );

  const applyZoom = useCallback(
    (nextZoomRaw: number) => {
      const nextZoom = clampMediaZoom(nextZoomRaw);
      setZoom(nextZoom);
      const rect = canvasRef.current?.getBoundingClientRect();
      setPan((prev) =>
        clampImagePan(prev, nextZoom, {
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        }),
      );
    },
    [clampImagePan],
  );

  const resetTransform = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
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
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        applyZoom(stepMediaZoom(zoom, MEDIA_ZOOM_STEP));
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        applyZoom(stepMediaZoom(zoom, -MEDIA_ZOOM_STEP));
      } else if (event.key === '0') {
        event.preventDefault();
        resetTransform();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setRotation((prev) => (prev + 90) % 360);
      } else if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setFlipX((prev) => !prev);
      } else if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        setFlipY((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyZoom, resetTransform, zoom]);

  const isQuarterRotated = rotation % 180 !== 0;
  let fittedDimensions: { width: number; height: number } | null = null;
  if (
    canvasSize.width > 0 &&
    canvasSize.height > 0 &&
    naturalSize &&
    naturalSize.width > 0 &&
    naturalSize.height > 0
  ) {
    const boundW = isQuarterRotated ? canvasSize.height : canvasSize.width;
    const boundH = isQuarterRotated ? canvasSize.width : canvasSize.height;
    const fitScale = Math.min(boundW / naturalSize.width, boundH / naturalSize.height);
    fittedDimensions = {
      width: Math.max(1, Math.round(naturalSize.width * fitScale)),
      height: Math.max(1, Math.round(naturalSize.height * fitScale)),
    };
  }

  if (hasError) {
    return (
      <MediaPlayerError
        icon={<ImageOff size={28} aria-hidden="true" />}
        title="Gambar gagal dimuat di pratinjau penuh"
        description="Sumber gambar menolak permintaan atau berformat tidak standar. Anda tetap dapat mengunduh atau menyalin tautan aset ini secara aman."
        filename={filename}
        declaredBytes={resource.declaredBytes}
        canDownload={canDownload}
        isDownloading={isDownloading}
        copied={copied}
        onDownload={onDownload}
        onCopy={onCopy}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#09090b] text-white select-none">
      <div
        ref={canvasRef}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) < 4) return;
          const step = e.deltaY < 0 ? MEDIA_WHEEL_ZOOM_STEP : -MEDIA_WHEEL_ZOOM_STEP;
          applyZoom(zoom + step);
        }}
        onPointerDown={(e) => {
          lastPointerTypeRef.current = e.pointerType;
          if (e.button !== 0) return;
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
              clampImagePan(
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
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-0 transition-colors duration-150 ${
          useLightBackdrop
            ? 'bg-[#f8f9fa] bg-[radial-gradient(#d1d5db_1px,transparent_1px)] [background-size:16px_16px]'
            : 'bg-[#0f0f12] bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px]'
        } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <img
          key={activeSrc}
          src={activeSrc}
          alt={filename}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setNaturalSize({
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }
          }}
          onClick={() => {
            if (suppressNextClickRef.current) {
              suppressNextClickRef.current = false;
              return;
            }
            if (!controlsVisible && lastPointerTypeRef.current !== 'mouse') {
              onRevealControls?.();
            }
          }}
          onError={advanceFallback}
          style={{
            ...(fittedDimensions
              ? {
                  width: `${fittedDimensions.width}px`,
                  height: `${fittedDimensions.height}px`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }
              : {}),
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${flipX ? -zoom : zoom}, ${flipY ? -zoom : zoom}) rotate(${rotation}deg)`,
          }}
          className={`${
            fittedDimensions ? 'shrink-0 object-contain' : 'h-full w-full object-contain'
          } ${
            isDragging
              ? 'transition-none'
              : 'transition-transform duration-150 ease-out'
          } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        />
      </div>

      <div
        onPointerEnter={onControlsPointerEnter}
        onPointerLeave={onControlsPointerLeave}
        onFocusCapture={onRevealControls}
        className={`absolute inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0d0d10]/90 pb-[env(safe-area-inset-bottom)] text-white backdrop-blur-sm transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
          controlsVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        <PageContainer className="flex min-h-[60px] items-center justify-between gap-2 py-2.5">
          <div className="inline-flex items-center gap-0.5">
            <button
              type="button"
              disabled={zoom <= MEDIA_MIN_ZOOM}
              onClick={() => applyZoom(zoom - MEDIA_ZOOM_STEP)}
              aria-label="Perkecil gambar"
              title="Perkecil (-)"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ZoomOut size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={resetTransform}
              aria-label="Reset zoom, rotasi, dan flip"
              title="Reset tampilan ke 100% (0)"
              className={`inline-flex h-9 min-w-[46px] items-center justify-center rounded-[var(--radius-sm)] px-1.5 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                zoom !== 1
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : 'text-white/85 hover:bg-white/10 hover:text-white'
              }`}
            >
              {Math.round(zoom * 100)}%
            </button>

            <button
              type="button"
              disabled={zoom >= MEDIA_MAX_ZOOM}
              onClick={() => applyZoom(zoom + MEDIA_ZOOM_STEP)}
              aria-label="Perbesar gambar"
              title="Perbesar (+)"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ZoomIn size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => setFlipX((prev) => !prev)}
              aria-pressed={flipX}
              aria-label="Balik gambar horizontal"
              title="Balik horizontal (H)"
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                flipX
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <FlipHorizontal2 size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setFlipY((prev) => !prev)}
              aria-pressed={flipY}
              aria-label="Balik gambar vertikal"
              title="Balik vertikal (V)"
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                flipY
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <FlipVertical2 size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setRotation((prev) => (prev + 90) % 360)}
              aria-label="Putar gambar 90 derajat"
              title="Putar 90° (R)"
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                rotation !== 0
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <RotateCw size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setUseLightBackdrop((prev) => !prev)}
              aria-pressed={useLightBackdrop}
              aria-label={useLightBackdrop ? 'Kembalikan latar gelap' : 'Gunakan latar terang'}
              title={useLightBackdrop ? 'Latar gelap' : 'Latar terang'}
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                useLightBackdrop
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              {useLightBackdrop ? (
                <Moon size={16} aria-hidden="true" />
              ) : (
                <Sun size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </PageContainer>
      </div>
    </div>
  );
}
