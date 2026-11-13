import { Download, Search, Trash2, Upload } from 'lucide-react';
import type { MediaBookmarkKind } from '../../types/bookmark';

export type MarkahKindFilter = 'all' | MediaBookmarkKind;

interface MarkahToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  kindFilter: MarkahKindFilter;
  onKindFilterChange: (value: MarkahKindFilter) => void;
  totalCount: number;
  imageCount: number;
  videoCount: number;
  filteredCount: number;
  onExportJson: () => void;
  onOpenImportModal: () => void;
  onRequestClearAll: () => void;
}

export function MarkahToolbar({
  query,
  onQueryChange,
  kindFilter,
  onKindFilterChange,
  totalCount,
  imageCount,
  videoCount,
  filteredCount,
  onExportJson,
  onOpenImportModal,
  onRequestClearAll,
}: MarkahToolbarProps) {
  const filterTabs: Array<{
    value: MarkahKindFilter;
    label: string;
    count: number;
  }> = [
    { value: 'all', label: 'Semua media', count: totalCount },
    { value: 'image', label: 'Gambar', count: imageCount },
    { value: 'video', label: 'Video', count: videoCount },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-soft)]"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Cari tautan media, nama file, atau host..."
            aria-label="Cari markah media"
            className="min-h-[40px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pr-3 pl-9 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-border-strong)] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenImportModal}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            <Upload size={14} aria-hidden="true" />
            <span>Impor JSON</span>
          </button>

          <button
            type="button"
            disabled={totalCount === 0}
            onClick={onExportJson}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3.5 py-2 text-xs font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" />
            <span>Ekspor JSON</span>
          </button>

          {totalCount > 0 ? (
            <button
              type="button"
              onClick={onRequestClearAll}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>Hapus semua</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Filter jenis media markah"
          className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-0.5"
        >
          {filterTabs.map((tab) => {
            const active = kindFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={active}
                onClick={() => onKindFilterChange(tab.value)}
                className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1 text-xs transition-colors duration-150 ${
                  active
                    ? 'bg-[var(--color-surface)] font-semibold text-[var(--color-text)] shadow-xs'
                    : 'font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="tabular-nums text-[11px] text-[var(--color-text-soft)]">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-[var(--color-text-soft)] tabular-nums">
          Menampilkan {filteredCount} dari {totalCount} markah tersimpan
        </p>
      </div>
    </div>
  );
}
