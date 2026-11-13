import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ImageOff,
  Maximize,
  Minimize,
  Moon,
  RotateCcw,
  RotateCw,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { PageContainer } from '../../../components/page-container';
import { useSettings } from '../../../hooks/use-settings';
import type { ResourceRecord } from '../../../types/inspection';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { MediaPlayerError } from './media-player-error';
import {
  clampMediaPan,
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
  onDownload,
  onCopy,
}: CustomImageViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
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

  const { settings } = useSettings();
  const isDarkTheme = settings.theme === 'dark';

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<MediaPanOffset>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [contrastBackdrop, setContrastBackdrop] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);

  const src = buildProxyAssetUrl(resource.url, inspectionId);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setHasError(false);
  }, [resource.id]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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

  const resetTransform = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
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
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyZoom, resetTransform, toggleFullscreen, zoom]);

  const isModified =
    zoom !== 1 || rotation !== 0 || Math.abs(pan.x) > 1 || Math.abs(pan.y) > 1;

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
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 transition-colors duration-150 sm:p-8 ${
          contrastBackdrop
            ? isDarkTheme
              ? 'bg-[#f8f9fa] bg-[radial-gradient(#d1d5db_1px,transparent_1px)] [background-size:16px_16px]'
              : 'bg-[#141416]'
            : 'bg-[var(--color-checker-bg)] bg-[radial-gradient(var(--color-checker-dot)_1px,transparent_1px)] [background-size:16px_16px]'
        } ${
          zoom > 1
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : ''
        }`}
      >
        <img
          key={src}
          src={src}
          alt={filename}
          draggable={false}
          referrerPolicy="no-referrer"
          onClick={() => {
            if (suppressNextClickRef.current) {
              suppressNextClickRef.current = false;
              return;
            }
            if (zoom > 1) {
              applyZoom(1);
            } else {
              applyZoom(2);
            }
          }}
          onError={() => setHasError(true)}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotate(${rotation}deg)`,
          }}
          className={`max-h-full max-w-full rounded-[var(--radius-sm)] object-contain ${
            isDragging
              ? 'transition-none'
              : 'transition-transform duration-150 ease-out'
          } ${
            zoom > 1
              ? isDragging
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : 'cursor-zoom-in'
          }`}
        />
      </div>

      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg)] pb-[env(safe-area-inset-bottom)]">
        <PageContainer className="flex min-h-[72px] flex-wrap items-center justify-between gap-2.5 py-2.5 sm:flex-nowrap">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-0.5">
              <button
                type="button"
                disabled={zoom <= MEDIA_MIN_ZOOM}
                onClick={() => applyZoom(zoom - MEDIA_ZOOM_STEP)}
                aria-label="Perkecil gambar"
                title="Perkecil (-)"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomOut size={15} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={resetTransform}
                aria-label="Reset zoom dan rotasi"
                title="Reset tampilan ke 100% (0)"
                className={`inline-flex h-8 min-w-[54px] items-center justify-center rounded-[6px] px-2 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                  zoom !== 1
                    ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomIn size={15} aria-hidden="true" />
              </button>
            </div>

            <input
              type="range"
              min={MEDIA_MIN_ZOOM}
              max={MEDIA_MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(e) => applyZoom(Number(e.target.value))}
              aria-label="Skala zoom gambar"
              className="hidden h-1 w-24 cursor-pointer accent-[var(--color-amber)] md:block lg:w-32"
            />

            {isModified ? (
              <button
                type="button"
                onClick={resetTransform}
                aria-label="Reset tampilan"
                title="Reset posisi, zoom, dan rotasi (0)"
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setRotation((prev) => (prev + 90) % 360)}
              aria-label="Putar gambar 90 derajat"
              title="Putar 90° (R)"
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] sm:px-3"
            >
              <RotateCw size={15} aria-hidden="true" />
              <span className="hidden sm:inline">Putar 90°</span>
            </button>

            <button
              type="button"
              onClick={() => setContrastBackdrop((prev) => !prev)}
              aria-pressed={contrastBackdrop}
              aria-label={
                contrastBackdrop
                  ? isDarkTheme
                    ? 'Kembalikan latar gelap'
                    : 'Kembalikan latar terang'
                  : isDarkTheme
                    ? 'Gunakan latar terang'
                    : 'Gunakan latar gelap'
              }
              title={
                contrastBackdrop
                  ? isDarkTheme
                    ? 'Kembalikan latar gelap'
                    : 'Kembalikan latar terang'
                  : isDarkTheme
                    ? 'Gunakan latar terang'
                    : 'Gunakan latar gelap'
              }
              className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium transition-colors duration-150 sm:px-3 ${
                contrastBackdrop
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]'
              }`}
            >
              {isDarkTheme ? (
                contrastBackdrop ? (
                  <Moon size={15} aria-hidden="true" />
                ) : (
                  <Sun size={15} aria-hidden="true" />
                )
              ) : contrastBackdrop ? (
                <Sun size={15} aria-hidden="true" />
              ) : (
                <Moon size={15} aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {isDarkTheme
                  ? contrastBackdrop
                    ? 'Latar gelap'
                    : 'Latar terang'
                  : contrastBackdrop
                    ? 'Latar terang'
                    : 'Latar gelap'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                void toggleFullscreen();
              }}
              aria-label={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
              title={isFullscreen ? 'Keluar layar penuh (F)' : 'Layar penuh (F)'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            >
              {isFullscreen ? (
                <Minimize size={16} aria-hidden="true" />
              ) : (
                <Maximize size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </PageContainer>
      </div>
    </div>
  );
}
