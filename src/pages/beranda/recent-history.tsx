import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import type { HistoryEntry } from '../../types/history';
import { formatTimestampId } from '../../utils/format-date';
import { buildResultsRoutePath } from '../hasil-pencarian/shared/results-navigation';

interface RecentHistoryProps {
  entries: HistoryEntry[];
  onRemoveEntry: (id: string) => void;
  onClearAll: () => void;
}

export function RecentHistory({
  entries,
  onRemoveEntry,
  onClearAll,
}: RecentHistoryProps) {
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  if (entries.length === 0) {
    return null;
  }

  const recentEntries = entries.slice(0, 5);

  return (
    <section
      aria-labelledby="riwayat-terbaru-heading"
      className="border-t border-[var(--color-border)] pt-8"
    >
      <div className="flex items-center justify-between gap-4">
        <h2
          id="riwayat-terbaru-heading"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          Riwayat terbaru
        </h2>
        <div className="flex items-center gap-4">
          <Link
            to="/riwayat-pencarian"
            className="text-xs font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]"
          >
            Lihat semua
          </Link>
          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            className="text-xs font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-danger)]"
          >
            Hapus riwayat
          </button>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {recentEntries.map((entry) => {
          const targetHref = buildResultsRoutePath('web', { url: entry.url });
          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <Link
                to={targetHref}
                state={{ inspectionId: entry.id, canonicalUrl: entry.url }}
                className="min-w-0 flex-1 rounded-[var(--radius-sm)] py-0.5 transition-colors duration-150 hover:text-[var(--color-amber-strong)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-[var(--color-text)]">
                    {entry.title ? `${entry.host} — ${entry.title}` : entry.host}
                  </span>
                  <span className="hidden shrink-0 text-xs tabular-nums text-[var(--color-text-soft)] sm:inline">
                    {formatTimestampId(entry.inspectedAt)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                  {entry.displayUrl}
                </p>
              </Link>

              <button
                type="button"
                onClick={() => onRemoveEntry(entry.id)}
                aria-label={`Hapus riwayat ${entry.host}`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-soft)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={onClearAll}
        title="Hapus semua riwayat?"
        description="Seluruh daftar riwayat tautan yang tersimpan di peramban ini akan dihapus permanen."
        confirmLabel="Hapus semua"
        cancelLabel="Batal"
        destructive
      />
    </section>
  );
}
