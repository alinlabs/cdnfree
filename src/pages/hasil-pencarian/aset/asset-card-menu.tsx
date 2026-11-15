import { Check, Copy, Download, Info, MoreVertical } from 'lucide-react';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';

interface AssetCardMenuProps {
  filename: string;
  isOpen: boolean;
  alignClassName?: string;
  menuTitle?: string;
  eligibleForDownload: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  onToggle: () => void;
  onOpenInfo: () => void;
  onCopy: () => void;
  onDownload: () => void;
  containerRef?: (node: HTMLDivElement | null) => void;
  triggerSizeClass?: string;
}

export function AssetCardMenu({
  filename,
  isOpen,
  alignClassName = 'right-0',
  menuTitle = 'Opsi aset',
  eligibleForDownload,
  downloadState,
  copied,
  onToggle,
  onOpenInfo,
  onCopy,
  onDownload,
  containerRef,
  triggerSizeClass = 'h-7 w-7',
}: AssetCardMenuProps) {
  const isDownloading = downloadState.status === 'downloading';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Opsi untuk ${filename}`}
        title={menuTitle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={`inline-flex ${triggerSizeClass} items-center justify-center rounded-full bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-[color,transform] duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-[var(--color-amber)] ${
          isOpen
            ? 'text-[var(--color-amber)]'
            : 'text-white/90 hover:text-white'
        }`}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={`Opsi aset ${filename}`}
          className={`absolute top-full z-40 mt-1.5 w-[min(calc(100vw-2rem),204px)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-left shadow-[var(--color-popover-shadow)] ${alignClassName}`}
        >
          <div className="border-b border-[var(--color-border)] px-2.5 py-1.5">
            <p
              className="truncate text-xs font-semibold text-[var(--color-text)]"
              title={filename}
            >
              {filename}
            </p>
          </div>

          <div className="mt-1 flex flex-col gap-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={onOpenInfo}
              className="inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <Info size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]" />
              <span>Info</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={onCopy}
              className="inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              {copied ? (
                <>
                  <Check
                    size={14}
                    aria-hidden="true"
                    className="shrink-0 text-[var(--color-success)]"
                  />
                  <span>Tersalin</span>
                </>
              ) : (
                <>
                  <Copy size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]" />
                  <span>Salin</span>
                </>
              )}
            </button>

            <button
              type="button"
              role="menuitem"
              disabled={!eligibleForDownload || isDownloading}
              onClick={onDownload}
              title={!eligibleForDownload ? 'Aset tidak dapat diunduh langsung' : undefined}
              className="inline-flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} aria-hidden="true" className="shrink-0 text-[var(--color-amber-strong)]" />
              <span>{isDownloading ? 'Mengunduh...' : 'Unduh'}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
