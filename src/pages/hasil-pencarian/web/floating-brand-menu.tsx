import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Database, Home, Info, PanelTop, RotateCw } from 'lucide-react';
import type { ResultsTabKey } from '../shared/results-navigation';

interface FloatingBrandMenuProps {
  onShowBar: () => void;
  onRefreshPage: () => void;
  onSelectTab: (tab: ResultsTabKey) => void;
  onOpenAssets: () => void;
  onGoHome: () => void;
  resourceCount: number;
  isReinspecting?: boolean;
  isPreparingAssets?: boolean;
}

interface Position {
  x: number;
  y: number;
}

const EDGE_MARGIN = 12;
const CARD_WIDTH_FALLBACK = 64;
const CARD_HEIGHT_FALLBACK = 56;
const DRAG_THRESHOLD_PX = 5;

function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): Position {
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(EDGE_MARGIN, x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, y), maxY),
  };
}

export function FloatingBrandMenu({
  onShowBar,
  onRefreshPage,
  onSelectTab,
  onOpenAssets,
  onGoHome,
  resourceCount,
  isReinspecting = false,
  isPreparingAssets = false,
}: FloatingBrandMenuProps) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [position, setPosition] = useState<Position>(() => {
    if (typeof window === 'undefined') {
      return { x: 16, y: 16 };
    }
    return clampPosition(
      window.innerWidth - CARD_WIDTH_FALLBACK - 16,
      window.innerHeight - CARD_HEIGHT_FALLBACK - 20,
      CARD_WIDTH_FALLBACK,
      CARD_HEIGHT_FALLBACK,
    );
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPosX: number;
    startPosY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const syncBounds = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const width = rect?.width || CARD_WIDTH_FALLBACK;
      const height = rect?.height || CARD_HEIGHT_FALLBACK;
      setPosition((prev) => clampPosition(prev.x, prev.y, width, height));
    };

    syncBounds();
    window.addEventListener('resize', syncBounds);
    return () => window.removeEventListener('resize', syncBounds);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleWindowBlur = () => {
      setMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [menuOpen]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosX: position.x,
      startPosY: position.y,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
      setIsDragging(true);
      setMenuOpen(false);
    }

    if (drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition(
        clampPosition(
          drag.startPosX + dx,
          drag.startPosY + dy,
          rect.width || CARD_WIDTH_FALLBACK,
          rect.height || CARD_HEIGHT_FALLBACK,
        ),
      );
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const wasMoved = drag.moved;
    dragRef.current = null;
    setIsDragging(false);

    if (!wasMoved) {
      setMenuOpen((prev) => !prev);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const openLeft =
    typeof window !== 'undefined' && position.x > window.innerWidth / 2;
  const openUp =
    typeof window !== 'undefined' && position.y > window.innerHeight / 2;

  return (
    <>
      {isDragging ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 cursor-grabbing select-none"
        />
      ) : null}

      <div
        ref={containerRef}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        className="fixed top-0 left-0 z-50"
      >
        <button
          ref={triggerRef}
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setMenuOpen((prev) => !prev);
            }
          }}
          aria-label="Menu mengambang CDNFREE"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-haspopup="menu"
          style={{ touchAction: 'none' }}
          className={`flex flex-col items-center gap-0.5 rounded-[10px] border border-white/15 bg-[#141414] p-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.34)] select-none transition-shadow duration-150 focus-visible:outline-2 focus-visible:outline-[var(--color-amber)] ${
            isDragging
              ? 'cursor-grabbing shadow-[0_16px_36px_rgba(0,0,0,0.44)]'
              : 'cursor-grab hover:border-white/25'
          }`}
        >
          <span className="inline-flex w-full items-center justify-center rounded-[6px] bg-[var(--color-amber)] px-2 py-0.5 text-[11px] font-extrabold leading-tight tracking-[-0.02em] text-white dark:text-[var(--color-on-amber)]">
            CDN
          </span>
          <span className="px-1 pt-0.5 text-[10px] font-bold leading-none tracking-[0.06em] text-white">
            FREE
          </span>
        </button>

        {menuOpen ? (
          <div
            id={menuId}
            role="menu"
            aria-label="Opsi tampilan web"
            className={`absolute z-50 w-52 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[0_14px_34px_rgba(20,20,20,0.2)] ${
              openLeft ? 'right-0' : 'left-0'
            } ${openUp ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onShowBar();
              }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <PanelTop
                size={15}
                aria-hidden="true"
                className="shrink-0 text-[var(--color-text-muted)]"
              />
              <span>Tampilkan bar</span>
            </button>

            <button
              type="button"
              role="menuitem"
              disabled={isReinspecting}
              onClick={() => {
                setMenuOpen(false);
                onRefreshPage();
              }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCw
                size={15}
                aria-hidden="true"
                className={`shrink-0 text-[var(--color-text-muted)] ${
                  isReinspecting ? 'animate-spin text-[var(--color-amber)]' : ''
                }`}
              />
              <span>Refresh halaman</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSelectTab('detail');
              }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <Info
                size={15}
                aria-hidden="true"
                className="shrink-0 text-[var(--color-text-muted)]"
              />
              <span>Lihat detail</span>
            </button>

            <button
              type="button"
              role="menuitem"
              disabled={isPreparingAssets}
              onClick={() => {
                setMenuOpen(false);
                onOpenAssets();
              }}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2.5">
                <Database
                  size={15}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--color-text-muted)]"
                />
                <span>Buka aset manager</span>
              </span>
              <span className="tabular-nums text-[11px] text-[var(--color-text-soft)]">
                {resourceCount}
              </span>
            </button>

            <div className="my-1 border-t border-[var(--color-border)]" role="separator" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onGoHome();
              }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <Home
                size={15}
                aria-hidden="true"
                className="shrink-0 text-[var(--color-text-muted)]"
              />
              <span>Kembali ke Beranda</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
