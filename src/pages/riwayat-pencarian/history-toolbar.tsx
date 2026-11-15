import { useEffect, useId, useRef, useState } from 'react';
import { Check, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type {
  HistoryHeaderControls,
  HistorySortOrder,
} from '../../components/nav-header-context';

export type { HistorySortOrder };

interface HistoryHeaderSearchProps {
  query: string;
  onQueryChange: (value: string) => void;
  onCloseSearch: () => void;
}

export function HistoryHeaderSearch({
  query,
  onQueryChange,
  onCloseSearch,
}: HistoryHeaderSearchProps) {
  const inputId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (query.trim()) return;
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        onCloseSearch();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [query, onCloseSearch]);

  return (
    <div
      ref={wrapperRef}
      className="min-w-0 flex-1 pl-1 sm:border-l sm:border-[var(--color-border)] sm:pl-3"
    >
      <label htmlFor={inputId} className="sr-only">
        Cari riwayat inspeksi
      </label>
      <div className="relative w-full">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-soft)]"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onQueryChange('');
              onCloseSearch();
            }
          }}
          placeholder="Cari URL, domain, atau judul halaman..."
          className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pr-9 pl-9 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none transition-colors duration-150 focus:border-[var(--color-amber)] focus:outline-none focus-visible:outline-none sm:text-sm"
        />
        <button
          type="button"
          onClick={() => {
            onQueryChange('');
            onCloseSearch();
          }}
          aria-label="Tutup pencarian riwayat"
          title="Tutup pencarian riwayat"
          className="absolute top-1/2 right-1 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-soft)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface HistoryFilterPopoverProps {
  sortOrder: HistorySortOrder;
  onSortOrderChange: (value: HistorySortOrder) => void;
  totalCount: number;
  filteredCount: number;
}

function HistoryFilterPopover({
  sortOrder,
  onSortOrderChange,
  totalCount,
  filteredCount,
}: HistoryFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const hasActiveFilter = sortOrder !== 'newest';

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
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const sortOptions: Array<{ value: HistorySortOrder; label: string }> = [
    { value: 'newest', label: 'Terbaru' },
    { value: 'oldest', label: 'Terlama' },
    { value: 'host', label: 'Host (A-Z)' },
  ];

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Filter dan urutkan riwayat"
        title="Filter dan urutkan riwayat"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        className={`relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 sm:h-9 sm:w-9 ${
          open || hasActiveFilter
            ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
        }`}
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
        {hasActiveFilter ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-amber)]"
          />
        ) : null}
      </button>

      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Filter dan urutkan riwayat"
          className="absolute right-0 z-50 mt-2 w-[min(calc(100vw-2rem),300px)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--color-popover-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2.5">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text)]">
                Urutkan riwayat
              </p>
              <p className="text-[11px] tabular-nums text-[var(--color-text-soft)]">
                {filteredCount} dari {totalCount} riwayat tersimpan
              </p>
            </div>

            {hasActiveFilter ? (
              <button
                type="button"
                onClick={() => onSortOrderChange('newest')}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--color-amber-strong)] transition-colors duration-150 hover:bg-[var(--color-amber-soft)]"
              >
                Reset
              </button>
            ) : null}
          </div>

          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-soft)]">
              Urutan daftar
            </p>
            <div className="space-y-1.5">
              {sortOptions.map((option) => {
                const selected = sortOrder === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onSortOrderChange(option.value);
                      setOpen(false);
                    }}
                    aria-pressed={selected}
                    className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-xs transition-colors duration-150 ${
                      selected
                        ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {selected ? (
                      <Check size={13} aria-hidden="true" className="shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface HistoryHeaderToolbarProps {
  controls: HistoryHeaderControls;
  searchOpen: boolean;
  onOpenSearch: () => void;
}

export function HistoryHeaderToolbar({
  controls,
  searchOpen,
  onOpenSearch,
}: HistoryHeaderToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Kontrol Riwayat Pencarian"
      className="flex shrink-0 items-center gap-0.5 sm:gap-1"
    >
      {!searchOpen ? (
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Cari riwayat"
          title="Cari riwayat"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] sm:h-9 sm:w-9"
        >
          <Search size={17} aria-hidden="true" />
        </button>
      ) : null}

      <HistoryFilterPopover
        sortOrder={controls.sortOrder}
        onSortOrderChange={controls.onSortOrderChange}
        totalCount={controls.totalCount}
        filteredCount={controls.filteredCount}
      />

      <button
        type="button"
        disabled={controls.totalCount === 0}
        onClick={controls.onRequestClearAll}
        aria-label="Hapus semua riwayat"
        title={
          controls.totalCount > 0
            ? 'Hapus semua riwayat'
            : 'Belum ada riwayat untuk dihapus'
        }
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
      >
        <Trash2 size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
