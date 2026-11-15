import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampMediaPan,
  clampMediaZoom,
  computeFittedMediaDimensions,
  MEDIA_WHEEL_ZOOM_STEP,
  type MediaPanOffset,
} from './media-player-utils';

export function useMediaStage(resetKey: string, hasError: boolean) {
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
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setNaturalSize(null);
  }, [resetKey]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    let rafId: number | null = null;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setCanvasSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
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
    setFlipX(false);
    setFlipY(false);
  }, []);

  const rotate90 = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const toggleFlipX = useCallback(() => {
    setFlipX((prev) => !prev);
  }, []);

  const toggleFlipY = useCallback(() => {
    setFlipY((prev) => !prev);
  }, []);

  const handleWheel = useCallback(
    (deltaY: number) => {
      if (Math.abs(deltaY) < 4) return;
      const step = deltaY < 0 ? MEDIA_WHEEL_ZOOM_STEP : -MEDIA_WHEEL_ZOOM_STEP;
      applyZoom(zoom + step);
    },
    [applyZoom, zoom],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      lastPointerTypeRef.current = e.pointerType;
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
    },
    [pan.x, pan.y, zoom],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [zoom],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [],
  );

  const handlePointerCancel = useCallback(() => {
    dragStateRef.current = null;
    setIsDragging(false);
  }, []);

  const fittedDimensions = computeFittedMediaDimensions(
    canvasSize,
    naturalSize,
    rotation,
  );

  return {
    canvasRef,
    suppressNextClickRef,
    lastPointerTypeRef,
    zoom,
    pan,
    rotation,
    flipX,
    flipY,
    isDragging,
    fittedDimensions,
    setNaturalSize,
    applyZoom,
    resetTransform,
    rotate90,
    toggleFlipX,
    toggleFlipY,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}
