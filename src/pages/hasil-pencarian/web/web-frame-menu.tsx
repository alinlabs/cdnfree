import { useEffect, useId, useRef, useState } from 'react';
import { EyeOff, Settings } from 'lucide-react';

interface WebFrameMenuProps {
  disabled?: boolean;
  onHideFrame: () => void;
}

export function WebFrameMenu({ disabled = false, onHideFrame }: WebFrameMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    const handleWindowBlur = () => {
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Pengaturan tampilan web"
        title="Pengaturan tampilan web"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
          open
            ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
        }`}
      >
        <Settings size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Opsi frame web"
          className="absolute right-0 z-50 mt-2 w-48 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--color-popover-shadow)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onHideFrame();
            }}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            <EyeOff
              size={14}
              aria-hidden="true"
              className="shrink-0 text-[var(--color-text-muted)]"
            />
            <span>Sembunyikan frame</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
