import { Check, Copy, Download } from 'lucide-react';
import { Modal } from '../../../components/modal';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetFilename,
  getImageFormatLabel,
  getObservationSourceLabel,
  getVideoFormatLabel,
} from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';
import { AssetDownloadStatus } from './asset-card-actions';

interface AssetInfoModalProps {
  resource: ResourceRecord | null;
  kind: 'image' | 'video';
  eligibleForDownload: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}

export function AssetInfoModal({
  resource,
  kind,
  eligibleForDownload,
  downloadState,
  copied,
  onCopy,
  onDownload,
  onClose,
}: AssetInfoModalProps) {
  if (!resource) return null;

  const filename = getAssetFilename(resource.url);
  const formatLabel =
    kind === 'image'
      ? getImageFormatLabel(resource)
      : getVideoFormatLabel(resource);
  const isFlagged =
    resource.classification !== 'allowed' &&
    resource.classification !== 'unknown';

  return (
    <Modal
      open={Boolean(resource)}
      onClose={onClose}
      title={kind === 'image' ? 'Info gambar' : 'Info video'}
      subtitle={filename}
      footer={
        <>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            {copied ? (
              <>
                <Check
                  size={14}
                  aria-hidden="true"
                  className="text-[var(--color-success)]"
                />
                <span>Tersalin</span>
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden="true" />
                <span>Salin</span>
              </>
            )}
          </button>

          {eligibleForDownload ? (
            <button
              type="button"
              disabled={downloadState.status === 'downloading'}
              onClick={onDownload}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3.5 py-2 text-xs font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={14} aria-hidden="true" />
              <span>
                {downloadState.status === 'downloading'
                  ? 'Mengunduh...'
                  : 'Unduh'}
              </span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[38px] items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tutup
          </button>
        </>
      }
    >
      <dl className="space-y-2.5 text-xs">
        <div>
          <dt className="font-medium text-[var(--color-text-soft)]">
            Nama berkas
          </dt>
          <dd className="mt-0.5 break-all font-medium text-[var(--color-text)]">
            {filename}
          </dd>
        </div>

        <div>
          <dt className="font-medium text-[var(--color-text-soft)]">Tautan</dt>
          <dd className="mt-0.5 break-all text-[var(--color-text-muted)] tabular-nums">
            {redactUrlForDisplay(resource.url)}
          </dd>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-0.5">
          <div>
            <dt className="font-medium text-[var(--color-text-soft)]">Host</dt>
            <dd className="mt-0.5 break-all text-[var(--color-text)]">
              {resource.host}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text-soft)]">
              Format / MIME
            </dt>
            <dd className="mt-0.5 break-all text-[var(--color-text)]">
              {resource.mimeType ?? formatLabel}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text-soft)]">
              Ukuran berkas
            </dt>
            <dd className="mt-0.5 text-[var(--color-text)] tabular-nums">
              {formatBytes(resource.declaredBytes)}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text-soft)]">
              Sumber
            </dt>
            <dd className="mt-0.5 text-[var(--color-text)]">
              {getObservationSourceLabel(
                resource,
                downloadState.status === 'downloaded',
              )}
            </dd>
          </div>
        </div>

        {resource.reason ? (
          <div>
            <dt className="font-medium text-[var(--color-text-soft)]">
              Keterangan
            </dt>
            <dd
              className={`mt-0.5 leading-relaxed ${
                isFlagged
                  ? 'font-medium text-[var(--color-amber-strong)]'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              {resource.reason}
            </dd>
          </div>
        ) : null}

        <AssetDownloadStatus state={downloadState} />
      </dl>
    </Modal>
  );
}
