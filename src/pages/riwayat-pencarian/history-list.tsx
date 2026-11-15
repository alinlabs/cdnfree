import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { restoreBulkInspectionSession } from '../../services/bulk-inspection-store';
import type { HistoryEntry } from '../../types/history';
import { formatTimestampId } from '../../utils/format-date';
import {
  buildHistoryDisplayUrl,
  formatHistoryAssetSummary,
  formatHistoryHeadline,
  resolveHistoryRoutePath,
} from '../../utils/history-format';
import type { ResultsRouteState } from '../hasil-pencarian/shared/workspace-route-state';

interface HistoryEntryRowProps {
  entry: HistoryEntry;
  onRemoveEntry: (id: string) => void;
}

function buildReopenState(entry: HistoryEntry): ResultsRouteState | undefined {
  if (entry.searchMode === 'bulk') {
    return undefined;
  }

  return {
    inspectionId: entry.id,
    canonicalUrl: entry.url,
    fromWeb:
      entry.targetKind === 'web' ||
      Boolean(entry.enabledTargets?.includes('web')),
    enabledTargets: entry.enabledTargets,
    assetFilters:
      entry.assetCategory || entry.assetFormats || entry.assetKeyword
        ? {
            jenis: entry.assetCategory,
            fmt: entry.assetFormats,
            q: entry.assetKeyword,
          }
        : undefined,
  };
}

function prepareReopen(entry: HistoryEntry): void {
  if (
    entry.searchMode === 'bulk' &&
    entry.bulkUrls &&
    entry.bulkUrls.length > 0
  ) {
    restoreBulkInspectionSession(entry.id, entry.bulkUrls, entry.inspectedAt);
  }
}

function HistoryEntryRow({ entry, onRemoveEntry }: HistoryEntryRowProps) {
  const headline = formatHistoryHeadline(entry);
  const routePath = resolveHistoryRoutePath(entry);
  const displayAppUrl = buildHistoryDisplayUrl(entry);
  const timestampText = formatTimestampId(entry.inspectedAt);
  const assetSummary = formatHistoryAssetSummary(entry);
  const reopenState = buildReopenState(entry);

  return (
    <li className="py-4 sm:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <Link
              to={routePath}
              state={reopenState}
              onClick={() => prepareReopen(entry)}
              className="text-sm font-semibold text-[var(--color-text)] transition-colors duration-150 hover:text-[var(--color-amber-strong)]"
            >
              {headline}
            </Link>
            {entry.status === 'failed' ? (
              <span className="text-xs font-medium text-[var(--color-danger)]">
                Gagal
              </span>
            ) : null}
          </div>

          <Link
            to={routePath}
            state={reopenState}
            onClick={() => prepareReopen(entry)}
            className="block break-all text-xs font-medium text-[var(--color-amber-strong)] transition-colors duration-150 hover:underline tabular-nums"
          >
            {displayAppUrl}
          </Link>

          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-[var(--color-text-soft)]">
            <span>{timestampText}</span>
            <span aria-hidden="true">·</span>
            <span>{assetSummary}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          <Link
            to={routePath}
            state={reopenState}
            onClick={() => prepareReopen(entry)}
            className="inline-flex min-h-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text)] transition-colors duration-150 hover:border-[var(--color-amber)] hover:bg-[var(--color-amber-soft)] hover:text-[var(--color-amber-strong)]"
          >
            Buka
          </Link>

          <button
            type="button"
            onClick={() => onRemoveEntry(entry.id)}
            aria-label={`Hapus riwayat ${headline} (${entry.host})`}
            title="Hapus riwayat"
            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)]"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}

interface HistoryListProps {
  entries: HistoryEntry[];
  onRemoveEntry: (id: string) => void;
}

export function HistoryList({ entries, onRemoveEntry }: HistoryListProps) {
  return (
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {entries.map((entry) => (
        <HistoryEntryRow
          key={entry.id}
          entry={entry}
          onRemoveEntry={onRemoveEntry}
        />
      ))}
    </ul>
  );
}
