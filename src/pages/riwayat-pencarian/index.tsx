import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { EmptyState } from '../../components/empty-state';
import { PageContainer } from '../../components/page-container';
import { useHistory } from '../../hooks/use-history';
import { useSettings } from '../../hooks/use-settings';
import { HistoryList } from './history-list';
import { HistoryToolbar, type HistorySortOrder } from './history-toolbar';

export function RiwayatPencarianPage() {
  const { entries, storageError, removeEntry, clearAll } = useHistory();
  const { settings } = useSettings();
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<HistorySortOrder>('newest');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const filteredAndSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (!q) return true;
      return (
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

  const retentionText =
    settings.privacy.historyRetentionDays === 0
      ? 'disimpan hingga Anda menghapusnya'
      : `disimpan otomatis selama ${settings.privacy.historyRetentionDays} hari`;

  return (
    <PageContainer className="py-8 sm:py-10">
      <div className="space-y-6">
        <div className="border-b border-[var(--color-border)] pb-5">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-[var(--color-text)] sm:text-[28px]">
            Riwayat pencarian
          </h1>
          <p className="mt-1.5 max-w-[72ch] text-sm text-[var(--color-text-muted)]">
            Riwayat tautan tersimpan secara lokal di peramban ini tanpa kuki, kredensial, atau isi HTML halaman. Parameter kueri sensitif disamarkan otomatis.
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-soft)]">
            Status penyimpanan: {settings.privacy.saveLocalHistory ? `Aktif (${retentionText})` : 'Dinonaktifkan di Pengaturan'}.{' '}
            <Link
              to="/pengaturan"
              className="underline underline-offset-4 hover:text-[var(--color-text)]"
            >
              Atur privasi
            </Link>
          </p>
        </div>

        {storageError ? (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3.5 text-xs font-medium text-[var(--color-danger)]"
          >
            {storageError}
          </div>
        ) : null}

        <HistoryToolbar
          query={query}
          onQueryChange={setQuery}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          totalCount={entries.length}
          filteredCount={filteredAndSorted.length}
          onRequestClearAll={() => setConfirmClearOpen(true)}
        />

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
        onConfirm={clearAll}
        title="Hapus semua riwayat?"
        description="Seluruh daftar riwayat tautan yang tersimpan di peramban ini akan dihapus permanen."
        confirmLabel="Hapus semua"
        cancelLabel="Batal"
        destructive
      />
    </PageContainer>
  );
}
