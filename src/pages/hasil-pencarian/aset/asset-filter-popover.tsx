import { useEffect, useId, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import {
  ASSET_FORMAT_PRESETS,
  ASSET_KIND_OPTIONS,
  ASSET_STATUS_OPTIONS,
  type AssetFormatToken,
  type AssetKindFilter,
  type AssetStatusFilter,
} from './asset-filters';

interface AssetFilterPopoverProps {
  kindFilter: AssetKindFilter;
  onKindFilterChange: (kind: AssetKindFilter) => void;
  formatFilters?: readonly AssetFormatToken[];
  onFormatFiltersChange?: (formats: AssetFormatToken[]) => void;
  statusFilter: AssetStatusFilter;
  onStatusFilterChange: (status: AssetStatusFilter) => void;
  filteredCount: number;
  totalCount: number;
}

export function AssetFilterPopover({
  kindFilter,
  onKindFilterChange,
  formatFilters = [],
  onFormatFiltersChange,
  statusFilter,
  onStatusFilterChange,
  filteredCount,
  totalCount,
}: AssetFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const hasActiveFilter =
    kindFilter !== 'all' || formatFilters.length > 0 || statusFilter !== 'all';

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

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Filter aset"
        title="Filter jenis dan status aset"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
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
          aria-label="Filter jenis dan status aset"
          className="absolute right-0 z-50 mt-2 max-h-[75dvh] w-[min(calc(100vw-2rem),360px)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--color-popover-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2.5">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text)]">
                Filter aset
              </p>
              <p className="text-[11px] tabular-nums text-[var(--color-text-soft)]">
                {filteredCount} dari {totalCount} aset cocok
              </p>
            </div>

            {hasActiveFilter ? (
              <button
                type="button"
                onClick={() => {
                  onKindFilterChange('all');
                  onFormatFiltersChange?.([]);
                  onStatusFilterChange('all');
                }}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--color-amber-strong)] transition-colors duration-150 hover:bg-[var(--color-amber-soft)]"
              >
                Reset
              </button>
            ) : null}
          </div>

          <div className="mt-3 space-y-3.5">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-soft)]">
                Jenis aset
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {ASSET_KIND_OPTIONS.map((option) => {
                  const selected = kindFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onKindFilterChange(option.value)}
                      aria-pressed={selected}
                      className={`inline-flex items-center justify-between gap-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-left text-xs transition-colors duration-150 ${
                        selected
                          ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      <span className="truncate">{option.label}</span>
                      {selected ? (
                        <Check size={12} aria-hidden="true" className="shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-soft)]">
                Status klasifikasi
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {ASSET_STATUS_OPTIONS.map((option) => {
                  const selected = statusFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onStatusFilterChange(option.value)}
                      aria-pressed={selected}
                      className={`inline-flex items-center justify-between gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
                        selected
                          ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      <span className="truncate">{option.label}</span>
                      {selected ? (
                        <Check size={12} aria-hidden="true" className="shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {onFormatFiltersChange ? (
              <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-soft)]">
                  Format file
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {ASSET_FORMAT_PRESETS.map((preset) => {
                    const selected = formatFilters.includes(preset.value);
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? formatFilters.filter((item) => item !== preset.value)
                            : [...formatFilters, preset.value];
                          onFormatFiltersChange(next);
                        }}
                        aria-pressed={selected}
                        className={`inline-flex items-center justify-center rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs transition-colors duration-150 ${
                          selected
                            ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)]'
                            : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
