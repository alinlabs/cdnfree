import {
  Bookmark,
  Check,
  Copy,
  Download,
  Maximize2,
  MoreVertical,
} from 'lucide-react';
import type { ResourceRecord } from '../../../types/inspection';
import { getObservationSourceLabel } from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';
import { AssetDownloadStatus } from './asset-card-actions';

interface AssetCardMenuProps {
  resource: ResourceRecord;
  filename: string;
  formatLabel: string;
  isOpen: boolean;
  alignClassName?: string;
  menuTitle?: string;
  eligibleForDownload: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onToggle: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onOpenFullView: () => void;
  containerRef?: (node: HTMLDivElement | null) => void;
  triggerSizeClass?: string;
}

export function AssetCardMenu({
  resource,
  filename,
  formatLabel,
  isOpen,
  alignClassName = 'right-0',
  menuTitle = 'Info & aksi aset',
  eligibleForDownload,
  downloadState,
  copied,
  isBookmarked = false,
  onToggleBookmark,
  onToggle,
  onDownload,
  onCopy,
  onOpenFullView,
  containerRef,
  triggerSizeClass = 'h-6 w-6 sm:h-7 sm:w-7',
}: AssetCardMenuProps) {
  const isFlagged =
    resource.classification !== 'allowed' &&
    resource.classification !== 'unknown';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Opsi dan informasi untuk ${filename}`}
        title={menuTitle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`inline-flex ${triggerSizeClass} items-center justify-center rounded-[var(--radius-sm)] border transition-colors duration-150 ${
          isOpen
            ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
        }`}
      >
        <MoreVertical size={13} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label={`Informasi aset ${filename}`}
          className={`absolute top-full z-40 mt-1.5 w-[min(calc(100vw-2rem),272px)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 text-left shadow-[var(--color-popover-shadow)] ${alignClassName}`}
        >
          <div className="space-y-1 border-b border-[var(--color-border)] pb-2.5">
            <p
              className="truncate text-xs font-semibold text-[var(--color-text)]"
              title={filename}
            >
              {filename}
            </p>
            <p className="break-all text-[11px] leading-snug text-[var(--color-text-muted)] tabular-nums line-clamp-2">
              {redactUrlForDisplay(resource.url)}
            </p>
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 pt-0.5 text-[11px] text-[var(--color-text-soft)]">
              <span className="break-all">{resource.host}</span>
              <span>{resource.mimeType ?? formatLabel}</span>
              <span className="tabular-nums">
                {formatBytes(resource.declaredBytes)}
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-soft)]">
              {getObservationSourceLabel(
                resource,
                downloadState.status === 'downloaded',
              )}
            </p>
            {resource.reason ? (
              <p
                className={`text-[11px] leading-snug ${
                  isFlagged
                    ? 'font-medium text-[var(--color-amber-strong)]'
                    : 'text-[var(--color-text-soft)]'
                }`}
              >
                {resource.reason}
              </p>
            ) : null}
            <AssetDownloadStatus state={downloadState} compact />
          </div>

          <div className="mt-2.5 flex flex-col gap-1">
            {onToggleBookmark ? (
              <button
                type="button"
                onClick={onToggleBookmark}
                className={`inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150 ${
                  isBookmarked
                    ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]'
                }`}
              >
                <Bookmark
                  size={13}
                  aria-hidden="true"
                  className={isBookmarked ? 'fill-current' : ''}
                />
                <span>
                  {isBookmarked ? 'Hapus dari markah' : 'Simpan ke markah'}
                </span>
              </button>
            ) : null}

            {eligibleForDownload ? (
              <button
                type="button"
                disabled={downloadState.status === 'downloading'}
                onClick={onDownload}
                className="inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download size={13} aria-hidden="true" />
                <span>
                  {downloadState.status === 'downloading'
                    ? 'Mengunduh...'
                    : 'Unduh aset'}
                </span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={onCopy}
              className="inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              {copied ? (
                <>
                  <Check
                    size={13}
                    aria-hidden="true"
                    className="text-[var(--color-success)]"
                  />
                  <span>Tautan tersalin</span>
                </>
              ) : (
                <>
                  <Copy size={13} aria-hidden="true" />
                  <span>Salin tautan</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenFullView}
              className="inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <Maximize2 size={13} aria-hidden="true" />
              <span>Buka tampilan penuh</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
