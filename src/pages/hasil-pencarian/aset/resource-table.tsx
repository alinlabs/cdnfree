import { useState } from 'react';
import { Eye } from 'lucide-react';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateAudioPreview,
  getAssetFilename,
  getInlineAssetPreviewKind,
  getObservationSourceLabel,
} from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { AssetCardActions, AssetDownloadStatus } from './asset-card-actions';
import { ASSET_KIND_LABELS } from './asset-filters';
import { ResourcePreviewModal } from './resource-preview-modal';

interface ResourceTableProps {
  inspectionId: string;
  resources: ResourceRecord[];
  resolveInspectionId?: (resource: ResourceRecord) => string;
}

export function ResourceTable({
  inspectionId,
  resources,
  resolveInspectionId,
}: ResourceTableProps) {
  const [previewResource, setPreviewResource] = useState<ResourceRecord | null>(null);
  const { isCopied, copyText } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  const renderPreviewButton = (
    resource: ResourceRecord,
    compact = false,
  ) => {
    const previewKind = getInlineAssetPreviewKind(resource);
    if (previewKind !== 'font' && previewKind !== 'text' && previewKind !== 'pdf') {
      return null;
    }

    return (
      <button
        type="button"
        onClick={() => setPreviewResource(resource)}
        className={`inline-flex ${compact ? '' : 'min-h-[36px] py-1'} items-center gap-1 text-xs font-semibold text-[var(--color-text)] transition-colors duration-150 hover:text-[var(--color-amber-strong)]`}
      >
        <Eye size={13} aria-hidden="true" />
        <span>Pratinjau</span>
      </button>
    );
  };

  return (
    <>
      <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] lg:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-xs font-semibold text-[var(--color-text-muted)]">
              <th scope="col" className="px-4 py-3">
                Nama / URL
              </th>
              <th scope="col" className="px-3 py-3 whitespace-nowrap">
                Jenis
              </th>
              <th scope="col" className="px-3 py-3">
                Host
              </th>
              <th scope="col" className="px-3 py-3">
                Sumber
              </th>
              <th scope="col" className="px-3 py-3 whitespace-nowrap">
                Ukuran
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Aksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)] bg-[var(--color-surface)]">
            {resources.map((resource) => {
              const eligibility = getAssetDownloadEligibility(resource);
              const fileName = getAssetFilename(resource.url);
              const isFlagged =
                resource.classification !== 'allowed' &&
                resource.classification !== 'unknown';
              const dlState = getDownloadState(resource.id);

              return (
                <tr
                  key={resource.id}
                  className="align-top transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]/60"
                >
                  <td className="max-w-[280px] px-4 py-3">
                    <p
                      className="truncate font-medium text-[var(--color-text)]"
                      title={fileName}
                    >
                      {fileName}
                    </p>
                    <p
                      className="mt-0.5 line-clamp-2 break-all text-xs text-[var(--color-text-muted)] tabular-nums"
                      title={redactUrlForDisplay(resource.url)}
                    >
                      {redactUrlForDisplay(resource.url)}
                    </p>
                    {resource.reason ? (
                      <p
                        className={`mt-1 text-xs ${
                          isFlagged
                            ? 'font-medium text-[var(--color-amber-strong)]'
                            : 'text-[var(--color-text-soft)]'
                        }`}
                      >
                        {resource.reason}
                      </p>
                    ) : null}
                    {getInlineAssetPreviewKind(resource) === 'audio' &&
                    evaluateAudioPreview(resource).canRenderAudio ? (
                      <audio
                        controls
                        preload="none"
                        src={buildProxyAssetUrl(
                          resource.url,
                          resolveInspectionId?.(resource) ?? inspectionId,
                        )}
                        aria-label={`Pemutar audio ${fileName}`}
                        className="mt-2 h-8 w-full max-w-[260px]"
                      />
                    ) : null}
                    <div className="mt-1">
                      <AssetDownloadStatus state={dlState} />
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-[var(--color-text)]">
                    {ASSET_KIND_LABELS[resource.kind]}
                    {resource.mimeType ? (
                      <span className="mt-0.5 block text-[11px] text-[var(--color-text-soft)]">
                        {resource.mimeType}
                      </span>
                    ) : null}
                  </td>
                  <td className="min-w-[140px] max-w-[210px] px-3 py-3 text-xs text-[var(--color-text-muted)] break-all">
                    {resource.host}
                  </td>
                  <td className="px-3 py-3 text-xs text-[var(--color-text-muted)]">
                    <span>
                      {getObservationSourceLabel(resource, dlState.status === 'downloaded')}
                    </span>
                    <span
                      className={`mt-0.5 block text-[11px] ${
                        eligibility.eligible
                          ? 'text-[var(--color-success)]'
                          : 'text-[var(--color-text-soft)]'
                      }`}
                    >
                      {eligibility.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                    {formatBytes(resource.declaredBytes)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <AssetCardActions
                      layout="column-end"
                      eligibleForDownload={eligibility.eligible}
                      isDownloading={dlState.status === 'downloading'}
                      isCopied={isCopied(resource.id)}
                      onDownload={() => {
                        void downloadResource(resource, fileName);
                      }}
                      onCopy={() => {
                        void copyText(resource.url, resource.id);
                      }}
                      externalUrl={resource.url}
                      externalWarningText={
                        isFlagged
                          ? resource.reason || 'Aset ditandai oleh aturan filter.'
                          : undefined
                      }
                      extraAction={renderPreviewButton(resource, true)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] lg:hidden">
        {resources.map((resource) => {
          const eligibility = getAssetDownloadEligibility(resource);
          const fileName = getAssetFilename(resource.url);
          const isFlagged =
            resource.classification !== 'allowed' &&
            resource.classification !== 'unknown';
          const dlState = getDownloadState(resource.id);

          return (
            <li key={resource.id} className="space-y-1.5 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-[var(--color-text)]">
                  {fileName}
                </span>
                <span className="shrink-0 text-xs text-[var(--color-text-soft)]">
                  {ASSET_KIND_LABELS[resource.kind]}
                </span>
              </div>

              <p
                className="line-clamp-2 break-all text-xs text-[var(--color-text-muted)] tabular-nums"
                title={redactUrlForDisplay(resource.url)}
              >
                {redactUrlForDisplay(resource.url)}
              </p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-soft)]">
                <span className="break-all">Host: {resource.host}</span>
                <span>
                  {getObservationSourceLabel(resource, dlState.status === 'downloaded')}
                </span>
                <span className="tabular-nums">{formatBytes(resource.declaredBytes)}</span>
              </div>

              <p
                className={`text-xs ${
                  eligibility.eligible
                    ? 'text-[var(--color-success)]'
                    : 'text-[var(--color-text-soft)]'
                }`}
              >
                {eligibility.label} — {eligibility.reason}
              </p>

              {resource.reason ? (
                <p className="text-xs font-medium text-[var(--color-amber-strong)]">
                  {resource.reason}
                </p>
              ) : null}

              <AssetDownloadStatus state={dlState} />

              {getInlineAssetPreviewKind(resource) === 'audio' &&
              evaluateAudioPreview(resource).canRenderAudio ? (
                <audio
                  controls
                  preload="none"
                  src={buildProxyAssetUrl(
                    resource.url,
                    resolveInspectionId?.(resource) ?? inspectionId,
                  )}
                  aria-label={`Pemutar audio ${fileName}`}
                  className="h-9 w-full"
                />
              ) : null}

              <div className="pt-1">
                <AssetCardActions
                  eligibleForDownload={eligibility.eligible}
                  isDownloading={dlState.status === 'downloading'}
                  isCopied={isCopied(resource.id)}
                  onDownload={() => {
                    void downloadResource(resource, fileName);
                  }}
                  onCopy={() => {
                    void copyText(resource.url, resource.id);
                  }}
                  externalUrl={resource.url}
                  externalWarningText={
                    isFlagged
                      ? resource.reason || 'Aset ditandai oleh aturan filter.'
                      : undefined
                  }
                  extraAction={renderPreviewButton(resource, false)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <ResourcePreviewModal
        inspectionId={inspectionId}
        resource={previewResource}
        resolveInspectionId={resolveInspectionId}
        onClose={() => setPreviewResource(null)}
      />
    </>
  );
}
