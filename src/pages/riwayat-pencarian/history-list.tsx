import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { HistoryEntry } from '../../types/history';
import { formatTimestampId } from '../../utils/format-date';
import { buildResultsRoutePath } from '../hasil-pencarian/shared/results-navigation';

interface HistoryListProps {
  entries: HistoryEntry[];
  onRemoveEntry: (id: string) => void;
}

export function HistoryList({ entries, onRemoveEntry }: HistoryListProps) {
  return (
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {entries.map((entry) => {
        const resultHref = buildResultsRoutePath('web', { url: entry.url });
        const linkState = { inspectionId: entry.id, canonicalUrl: entry.url };

        return (
          <li
            key={entry.id}
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  to={resultHref}
                  state={linkState}
                  className="min-w-0 max-w-full truncate text-sm font-semibold text-[var(--color-text)] transition-colors duration-150 hover:text-[var(--color-amber-strong)]"
                >
                  {entry.title ? `${entry.host} — ${entry.title}` : entry.host}
                </Link>
                <span
                  className={`text-xs font-medium ${
                    entry.status === 'completed'
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-danger)]'
                  }`}
                >
                  {entry.status === 'completed' ? 'Selesai' : 'Gagal'}
                </span>
              </div>

              <p className="break-all text-xs text-[var(--color-text-muted)] tabular-nums">
                {entry.displayUrl}
              </p>

              <p className="text-xs tabular-nums text-[var(--color-text-soft)]">
                Diperiksa {formatTimestampId(entry.inspectedAt)}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Link
                to={resultHref}
                state={linkState}
                className="inline-flex min-h-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Buka hasil
              </Link>

              <button
                type="button"
                onClick={() => onRemoveEntry(entry.id)}
                aria-label={`Hapus riwayat ${entry.host}`}
                className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
