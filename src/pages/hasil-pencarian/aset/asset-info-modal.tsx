import { useEffect, useState } from 'react';
import { Check, Copy, Download, HardDrive, Trash2 } from 'lucide-react';
import { Modal } from '../../../components/modal';
import { smartCacheDb, type SmartCacheEntry } from '../../../services/smart-cache-db';
import { triggerVideoHydration } from '../../../services/smart-cache-hydrator';
import { deleteSmartCacheArtifacts } from '../../../services/smart-cache-storage';
import { getCanonicalVideoKey } from '../../../services/video-playback-store';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetFilename,
  getImageFormatLabel,
  getObservationSourceLabel,
  getVideoFormatLabel,
} from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { isHlsResource, resolveInlineStreamUrl } from '../../../utils/proxy-url';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';
import { AssetDownloadStatus } from './asset-card-actions';

interface AssetInfoModalProps {
  resource: ResourceRecord | null;
  kind: 'image' | 'video';
  inspectionId?: string;
  isBookmarked?: boolean;
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
  inspectionId,
  isBookmarked = false,
  eligibleForDownload,
  downloadState,
  copied,
  onCopy,
  onDownload,
  onClose,
}: AssetInfoModalProps) {
  const smartCacheKey =
    resource && kind === 'video' ? getCanonicalVideoKey(resource) : null;
  const [cacheEntry, setCacheEntry] = useState<SmartCacheEntry | null>(() =>
    smartCacheKey ? smartCacheDb.getEntrySync(smartCacheKey) : null,
  );
  const [cacheActionBusy, setCacheActionBusy] = useState(false);

  useEffect(() => {
    if (!smartCacheKey) {
      setCacheEntry(null);
      return;
    }
    let cancelled = false;
    void smartCacheDb.init().then(() => {
      if (!cancelled) {
        setCacheEntry(smartCacheDb.getEntrySync(smartCacheKey));
      }
    });
    const unsub = smartCacheDb.subscribe(() => {
      setCacheEntry(smartCacheDb.getEntrySync(smartCacheKey));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [smartCacheKey]);

  if (!resource) return null;

  const filename = getAssetFilename(resource.url);
  const formatLabel =
    kind === 'image'
      ? getImageFormatLabel(resource)
      : getVideoFormatLabel(resource);
  const isFlagged =
    resource.classification !== 'allowed' &&
    resource.classification !== 'unknown';

  const handleSaveOffline = async () => {
    if (!smartCacheKey || cacheActionBusy) return;
    setCacheActionBusy(true);
    try {
      const fetchUrl = resolveInlineStreamUrl(resource, inspectionId);
      const isHls = isHlsResource(resource);
      await triggerVideoHydration({
        resource,
        fetchUrl,
        isHls,
        isBookmarked,
        urlsToAlias: [resource.url, fetchUrl],
      });
    } finally {
      setCacheActionBusy(false);
    }
  };

  const handleDeleteOffline = async () => {
    if (!smartCacheKey || cacheActionBusy) return;
    setCacheActionBusy(true);
    try {
      await deleteSmartCacheArtifacts(smartCacheKey);
    } finally {
      setCacheActionBusy(false);
    }
  };

  const cacheStatusText =
    cacheEntry?.status === 'complete'
      ? `Tersedia offline (${formatBytes(cacheEntry.totalBytes)})`
      : cacheEntry?.status === 'hydrating'
        ? cacheEntry.totalBytes > 0
          ? `Menyimpan... ${Math.min(
              99,
              Math.round((cacheEntry.hydratedBytes / cacheEntry.totalBytes) * 100),
            )}%`
          : 'Menyimpan ke cache offline...'
        : 'Belum tersimpan';

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

        {kind === 'video' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2">
            <div>
              <dt className="font-medium text-[var(--color-text-soft)]">
                Cache Offline
              </dt>
              <dd className="mt-0.5 font-medium text-[var(--color-text)] tabular-nums">
                {cacheStatusText}
              </dd>
            </div>
            {cacheEntry?.status === 'complete' ? (
              <button
                type="button"
                disabled={cacheActionBusy}
                onClick={() => void handleDeleteOffline()}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-danger)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:opacity-60"
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>Hapus cache offline</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={cacheActionBusy || cacheEntry?.status === 'hydrating'}
                onClick={() => void handleSaveOffline()}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:opacity-60"
              >
                <HardDrive size={13} aria-hidden="true" />
                <span>
                  {cacheEntry?.status === 'hydrating' || cacheActionBusy
                    ? 'Menyimpan...'
                    : 'Simpan offline'}
                </span>
              </button>
            )}
          </div>
        ) : null}

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
