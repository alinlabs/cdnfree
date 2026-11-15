import type { ReactNode } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';

interface AssetDownloadStatusProps {
  state: ResourceDownloadState;
  compact?: boolean;
}

export function AssetDownloadStatus({
  state,
  compact = false,
}: AssetDownloadStatusProps) {
  if (!state.message) return null;

  const sizeClass = compact ? 'text-[11px]' : 'text-xs';

  if (state.status === 'error') {
    return (
      <p role="alert" className={`${sizeClass} font-medium text-[var(--color-danger)]`}>
        {state.message}
      </p>
    );
  }

  if (state.status === 'downloaded') {
    return (
      <p className={`${sizeClass} font-medium text-[var(--color-success)]`}>
        {state.message}
      </p>
    );
  }

  return null;
}

interface AssetCardActionsProps {
  eligibleForDownload: boolean;
  isDownloading: boolean;
  isCopied: boolean;
  onDownload: () => void;
  onCopy: () => void;
  externalUrl?: string;
  externalWarningText?: string;
  extraAction?: ReactNode;
  layout?: 'row' | 'column-end';
}

export function AssetCardActions({
  eligibleForDownload,
  isDownloading,
  isCopied,
  onDownload,
  onCopy,
  externalUrl,
  externalWarningText,
  extraAction,
  layout = 'row',
}: AssetCardActionsProps) {
  const containerClass =
    layout === 'column-end'
      ? 'inline-flex flex-col items-end gap-1.5'
      : 'flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-[var(--color-border)] pt-2';

  const buttonPadClass = layout === 'column-end' ? '' : 'min-h-[36px] py-1';

  return (
    <div className={containerClass}>
      {layout === 'column-end' ? extraAction : null}

      {eligibleForDownload ? (
        <button
          type="button"
          disabled={isDownloading}
          onClick={onDownload}
          className={`inline-flex ${buttonPadClass} items-center gap-1 text-xs font-semibold text-[var(--color-amber-strong)] transition-colors duration-150 hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <Download size={13} aria-hidden="true" />
          <span>{isDownloading ? 'Mengunduh...' : 'Unduh aset'}</span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={onCopy}
        className={`inline-flex ${buttonPadClass} items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]`}
      >
        {isCopied ? (
          <>
            <Check
              size={13}
              aria-hidden="true"
              className="text-[var(--color-success)]"
            />
            <span>Tersalin</span>
          </>
        ) : (
          <>
            <Copy size={13} aria-hidden="true" />
            <span>Salin tautan</span>
          </>
        )}
      </button>

      {layout !== 'column-end' ? extraAction : null}

      {externalUrl ? (
        <ExternalLinkAction
          direct
          url={externalUrl}
          label="Buka aset"
          warningText={externalWarningText}
          variant="text"
        />
      ) : null}
    </div>
  );
}
