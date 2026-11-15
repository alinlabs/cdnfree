import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { HistoryEntry } from '../../types/history';
import { formatTimestampId } from '../../utils/format-date';
import {
  MediaGalleriesGrid,
  splitGalleryMedia,
} from '../hasil-pencarian/aset/media-galleries-grid';
import { buildResultsRoutePath } from '../hasil-pencarian/shared/results-navigation';

interface HistoryEntryCardProps {
  entry: HistoryEntry;
  onRemoveEntry: (id: string) => void;
  onOpenFullView: (
    entryId: string,
    kind: 'image' | 'video',
    resourceId: string,
  ) => void;
}

function HistoryEntryRow({
  entry,
  onRemoveEntry,
  onOpenFullView,
}: HistoryEntryCardProps) {
  const resultWebHref = buildResultsRoutePath('web', { url: entry.url });
  const resultAsetHref = buildResultsRoutePath('aset', { url: entry.url });
  const linkState = { inspectionId: entry.id, canonicalUrl: entry.url };

  const media = useMemo(
    () => splitGalleryMedia(entry.previewResources ?? []),
    [entry.previewResources],
  );

  const hasMediaPreviews =
    media.imageAssets.length > 0 ||
    media.vectorAssets.length > 0 ||
    media.validVideoAssets.length > 0;

  return (
    <li className="space-y-5 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              to={resultWebHref}
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

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-[var(--color-text-soft)]">
            <span>Diperiksa {formatTimestampId(entry.inspectedAt)}</span>
            {typeof entry.totalResourceCount === 'number' &&
            entry.totalResourceCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{entry.totalResourceCount} aset terdeteksi</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to={resultAsetHref}
            state={linkState}
            className="inline-flex min-h-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Buka aset
          </Link>

          <Link
            to={resultWebHref}
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
      </div>

      {hasMediaPreviews ? (
        <div className="space-y-6">
          <MediaGalleriesGrid
            inspectionId=""
            sourcePageUrl={entry.url}
            imageAssets={media.imageAssets}
            vectorAssets={media.vectorAssets}
            validVideoAssets={media.validVideoAssets}
            showImages={media.imageAssets.length > 0}
            showVectors={media.vectorAssets.length > 0}
            showVideos={media.validVideoAssets.length > 0}
            onOpenFullView={(kind, resourceId) =>
              onOpenFullView(entry.id, kind, resourceId)
            }
          />
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-soft)]">
          Belum ada pratinjau foto, vektor, atau video tersimpan untuk pemeriksaan ini. Buka hasil untuk memindai media halaman.
        </p>
      )}
    </li>
  );
}

interface HistoryListProps {
  entries: HistoryEntry[];
  onRemoveEntry: (id: string) => void;
  onOpenFullView: (
    entryId: string,
    kind: 'image' | 'video',
    resourceId: string,
  ) => void;
}

export function HistoryList({
  entries,
  onRemoveEntry,
  onOpenFullView,
}: HistoryListProps) {
  return (
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {entries.map((entry) => (
        <HistoryEntryRow
          key={entry.id}
          entry={entry}
          onRemoveEntry={onRemoveEntry}
          onOpenFullView={onOpenFullView}
        />
      ))}
    </ul>
  );
}
