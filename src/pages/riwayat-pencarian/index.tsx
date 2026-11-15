import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { EmptyState } from '../../components/empty-state';
import {
  useNavHeaderContext,
  type HistoryHeaderControls,
  type HistorySortOrder,
} from '../../components/nav-header-context';
import { PageContainer } from '../../components/page-container';
import { useHistory } from '../../hooks/use-history';
import {
  buildHistoryDisplayUrl,
  formatHistoryAssetSummary,
  formatHistoryHeadline,
} from '../../utils/history-format';
import { HistoryList } from './history-list';

export function RiwayatPencarianPage() {
  const { entries, storageError, removeEntry, clearAll } = useHistory();
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<HistorySortOrder>('newest');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const filteredAndSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (!q) return true;
      const headline = formatHistoryHeadline(entry).toLowerCase();
      const appUrl = buildHistoryDisplayUrl(entry).toLowerCase();
      const summary = formatHistoryAssetSummary(entry).toLowerCase();
      return (
        headline.includes(q) ||
        appUrl.includes(q) ||
        summary.includes(q) ||
        entry.host.toLowerCase().includes(q) ||
        entry.displayUrl.toLowerCase().includes(q) ||
        (entry.title ?? '').toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortOrder === 'host') {
        return a.host.localeCompare(b.host, 'id');
      }
      const timeA = Date.parse(a.inspectedAt) || 0;
      const timeB = Date.parse(b.inspectedAt) || 0;
      return sortOrder === 'oldest' ? timeA - timeB : timeB - timeA;
    });
  }, [entries, query, sortOrder]);

  const { setHistoryControls } = useNavHeaderContext();

  const headerControls = useMemo<HistoryHeaderControls>(
    () => ({
      query,
      onQueryChange: setQuery,
      sortOrder,
      onSortOrderChange: setSortOrder,
      totalCount: entries.length,
      filteredCount: filteredAndSorted.length,
      onRequestClearAll: () => setConfirmClearOpen(true),
    }),
    [query, sortOrder, entries.length, filteredAndSorted.length],
  );

  useEffect(() => {
    setHistoryControls(headerControls);
  }, [headerControls, setHistoryControls]);

  useEffect(() => {
    return () => setHistoryControls(null);
  }, [setHistoryControls]);

  return (
    <PageContainer className="py-5 sm:py-6">
      <div className="space-y-6">
        {storageError ? (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3.5 text-xs font-medium text-[var(--color-danger)]"
          >
            {storageError}
          </div>
        ) : null}

        {entries.length === 0 ? (
          <EmptyState
            title="Belum ada riwayat tautan."
            description="Riwayat akan muncul di sini setelah Anda menjalankan pemeriksaan URL dari halaman Beranda."
            action={
              <Link
                to="/"
                className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
              >
                Periksa tautan di Beranda
              </Link>
            }
          />
        ) : filteredAndSorted.length === 0 ? (
          <EmptyState
            title="Tidak ada riwayat yang cocok"
            description="Ubah kata kunci pencarian untuk menemukan tautan yang pernah diperiksa."
          />
        ) : (
          <HistoryList entries={filteredAndSorted} onRemoveEntry={removeEntry} />
        )}
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          clearAll();
        }}
        title="Hapus semua riwayat?"
        description="Seluruh daftar riwayat tautan yang tersimpan di peramban ini akan dihapus permanen."
        confirmLabel="Hapus semua"
        cancelLabel="Batal"
        destructive
      />
    </PageContainer>
  );
}
