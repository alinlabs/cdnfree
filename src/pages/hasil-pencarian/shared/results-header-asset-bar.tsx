import { useEffect, useId, useRef, useState } from 'react';
import { Download, RefreshCw, Search, X } from 'lucide-react';
import { AssetFilterPopover } from '../aset/asset-filter-popover';
import type {
  AssetFormatToken,
  AssetKindFilter,
  AssetStatusFilter,
} from '../aset/asset-filters';

export interface AssetHeaderControls {
  query: string;
  onQueryChange: (value: string) => void;
  kindFilter: AssetKindFilter;
  onKindFilterChange: (kind: AssetKindFilter) => void;
  formatFilters: AssetFormatToken[];
  onFormatFiltersChange: (formats: AssetFormatToken[]) => void;
  statusFilter: AssetStatusFilter;
  onStatusFilterChange: (status: AssetStatusFilter) => void;
  filteredCount: number;
  totalCount: number;
  downloadableCount: number;
  batchDownloading: boolean;
  onDownloadAll: () => void;
  onCancelDownloadAll: () => void;
  onRefreshAssets: () => void;
}

interface ResultsHeaderAssetSearchProps {
  assetControls: AssetHeaderControls;
  onCloseSearch: () => void;
}

export function ResultsHeaderAssetSearch({
  assetControls,
  onCloseSearch,
}: ResultsHeaderAssetSearchProps) {
  const assetSearchInputId = useId();
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
      if (assetControls.query.trim()) return;
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
  }, [assetControls.query, onCloseSearch]);

  return (
    <div
      ref={wrapperRef}
      className="min-w-0 flex-1 border-l border-[var(--color-border)] pl-3"
    >
      <label htmlFor={assetSearchInputId} className="sr-only">
        Cari nama file, host, atau jenis aset
      </label>
      <div className="relative w-full">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-soft)]"
        />
        <input
          ref={inputRef}
          id={assetSearchInputId}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={assetControls.query}
          onChange={(event) => assetControls.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              assetControls.onQueryChange('');
              onCloseSearch();
            }
          }}
          placeholder="Cari nama file, host, atau jenis aset..."
          className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pr-9 pl-9 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:border-[var(--color-amber)] focus:outline-none focus-visible:outline-none transition-colors duration-150 sm:text-sm"
        />
        <button
          type="button"
          onClick={() => {
            assetControls.onQueryChange('');
            onCloseSearch();
          }}
          aria-label="Tutup pencarian aset"
          title="Tutup pencarian aset"
          className="absolute top-1/2 right-1 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-soft)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface ResultsHeaderAssetToolbarProps {
  assetControls: AssetHeaderControls;
  assetSearchOpen: boolean;
  onOpenSearch: () => void;
}

export function ResultsHeaderAssetToolbar({
  assetControls,
  assetSearchOpen,
  onOpenSearch,
}: ResultsHeaderAssetToolbarProps) {
  const [isRefreshingAssets, setIsRefreshingAssets] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const handleRefreshAssetsClick = () => {
    assetControls.onRefreshAssets();
    setIsRefreshingAssets(true);
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      setIsRefreshingAssets(false);
    }, 550);
  };

  return (
    <div
      role="toolbar"
      aria-label="Kontrol Aset Manager"
      className="flex shrink-0 items-center gap-1"
    >
      {!assetSearchOpen ? (
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Cari aset"
          title="Cari aset"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
        >
          <Search size={17} aria-hidden="true" />
        </button>
      ) : null}

      <AssetFilterPopover
        kindFilter={assetControls.kindFilter}
        onKindFilterChange={assetControls.onKindFilterChange}
        formatFilters={assetControls.formatFilters}
        onFormatFiltersChange={assetControls.onFormatFiltersChange}
        statusFilter={assetControls.statusFilter}
        onStatusFilterChange={assetControls.onStatusFilterChange}
        filteredCount={assetControls.filteredCount}
        totalCount={assetControls.totalCount}
      />

      {assetControls.batchDownloading ? (
        <button
          type="button"
          onClick={assetControls.onCancelDownloadAll}
          aria-label="Batalkan unduhan massal"
          title="Batalkan unduhan massal"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber-soft)] text-[var(--color-danger)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
        >
          <X size={17} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          disabled={assetControls.downloadableCount === 0}
          onClick={assetControls.onDownloadAll}
          aria-label={`Unduh semua (${assetControls.downloadableCount})`}
          title={
            assetControls.downloadableCount > 0
              ? `Unduh semua (${assetControls.downloadableCount})`
              : 'Tidak ada aset yang dapat diunduh'
          }
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={17} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={handleRefreshAssetsClick}
        aria-label="Segarkan aset"
        title="Segarkan aset"
        className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
      >
        <RefreshCw
          size={17}
          aria-hidden="true"
          className={isRefreshingAssets ? 'animate-spin text-[var(--color-amber)]' : ''}
        />
      </button>
    </div>
  );
}
