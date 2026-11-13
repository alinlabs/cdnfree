import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { getFocusableElements, trapTabFocus } from '../utils/focus-trap';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  bounds?: 'viewport' | 'workspace';
}

const MODAL_SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

const openModalStack: symbol[] = [];
let savedBodyOverflow: string | null = null;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  bounds = 'viewport',
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const modalToken = Symbol('modal');
    if (openModalStack.length === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openModalStack.push(modalToken);

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = window.requestAnimationFrame(() => {
      if (openModalStack[openModalStack.length - 1] !== modalToken) return;
      const focusables = getFocusableElements(dialogRef.current);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialogRef.current?.focus();
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openModalStack[openModalStack.length - 1] !== modalToken) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      trapTabFocus(event, dialogRef.current);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);

      const stackIdx = openModalStack.lastIndexOf(modalToken);
      if (stackIdx !== -1) {
        openModalStack.splice(stackIdx, 1);
      }
      if (openModalStack.length === 0 && savedBodyOverflow !== null) {
        document.body.style.overflow = savedBodyOverflow;
        savedBodyOverflow = null;
      }

      const previousTarget = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousTarget && previousTarget.isConnected) {
        previousTarget.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const wrapperPaddingClass =
    bounds === 'workspace'
      ? 'px-4 pt-[calc(3.5rem+0.75rem+env(safe-area-inset-top))] pb-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] sm:px-6 md:pt-[calc(4rem+1rem)] md:pb-[calc(5.25rem+1rem)]'
      : 'p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${wrapperPaddingClass}`}
      role="presentation"
    >
      <div
        className="fixed inset-0 bg-[var(--color-backdrop)] transition-opacity duration-150 motion-reduce:transition-none"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex max-h-full w-full ${MODAL_SIZE_CLASS[size]} flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm transition-transform duration-150 motion-reduce:transition-none sm:p-6`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] pb-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="min-w-0 text-base font-semibold text-[var(--color-text)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Tutup dialog"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain text-sm text-[var(--color-text-muted)]">
          {children}
        </div>

        {footer ? (
          <div className="mt-5 flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-[var(--color-border)] pt-4 sm:gap-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
