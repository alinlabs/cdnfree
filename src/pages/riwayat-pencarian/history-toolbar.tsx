import { Search } from 'lucide-react';

export type HistorySortOrder = 'newest' | 'oldest' | 'host';

interface HistoryToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  sortOrder: HistorySortOrder;
  onSortOrderChange: (value: HistorySortOrder) => void;
  totalCount: number;
  filteredCount: number;
  onRequestClearAll: () => void;
}

export function HistoryToolbar({
  query,
  onQueryChange,
  sortOrder,
  onSortOrderChange,
  totalCount,
  filteredCount,
  onRequestClearAll,
}: HistoryToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-soft)]"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Cari URL, domain, atau judul halaman..."
            aria-label="Cari riwayat inspeksi"
            className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pr-3 pl-9 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={sortOrder}
            onChange={(event) =>
              onSortOrderChange(event.target.value as HistorySortOrder)
            }
            aria-label="Urutkan riwayat"
            className="h-10 min-w-0 max-w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value="newest">Urutkan: Terbaru</option>
            <option value="oldest">Urutkan: Terlama</option>
            <option value="host">Urutkan: Host (A-Z)</option>
          </select>

          <button
            type="button"
            disabled={totalCount === 0}
            onClick={onRequestClearAll}
            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Hapus semua
          </button>
        </div>
      </div>

      {totalCount > 0 ? (
        <p className="text-xs tabular-nums text-[var(--color-text-soft)]">
          Menampilkan {filteredCount} dari {totalCount} riwayat tersimpan
        </p>
      ) : null}
    </div>
  );
}
