import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { getFocusableElements, trapTabFocus } from '../utils/focus-trap';

interface DrawerProps {
  id?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  closeLabel?: string;
  side?: 'left' | 'right';
  width?: 'narrow' | 'wide';
  children: ReactNode;
}

export function Drawer({
  id,
  open,
  onClose,
  title,
  subtitle,
  closeLabel = 'Tutup panel',
  side = 'right',
  width = 'narrow',
  children,
}: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      const focusables = getFocusableElements(panelRef.current);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        panelRef.current?.focus();
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      trapTabFocus(event, panelRef.current);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const previousTarget = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousTarget && previousTarget.isConnected) {
        previousTarget.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const sideClasses =
    side === 'left'
      ? 'left-0 border-r'
      : 'right-0 border-l';

  const widthClasses =
    width === 'wide'
      ? 'w-[min(calc(100vw-24px),420px)] sm:w-[420px]'
      : 'w-[min(calc(100vw-24px),340px)]';

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <div
        className="fixed inset-0 bg-[var(--color-backdrop)] transition-opacity duration-150 motion-reduce:transition-none"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        id={id}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`fixed inset-y-0 z-10 flex h-dvh flex-col border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-transform duration-150 motion-reduce:transition-none ${widthClasses} ${sideClasses}`}
      >
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold text-[var(--color-text)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="truncate text-xs text-[var(--color-text-soft)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label={closeLabel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
