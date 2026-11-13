import { useState } from 'react';
import { FileText, Maximize2 } from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';
import { Modal } from '../../../components/modal';
import { PdfThumbnail, PdfViewerSurface } from '../../../components/pdf-preview';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluatePdfPreview,
  getAssetFilename,
  getObservationSourceLabel,
} from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { AssetCardActions, AssetDownloadStatus } from './asset-card-actions';

interface DocumentGalleryProps {
  inspectionId: string;
  documents: ResourceRecord[];
  resolveInspectionId?: (resource: ResourceRecord) => string;
}

const INITIAL_DOC_BATCH = 12;

export function DocumentGallery({
  inspectionId,
  documents,
  resolveInspectionId,
}: DocumentGalleryProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_DOC_BATCH);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [inspectedDoc, setInspectedDoc] = useState<ResourceRecord | null>(null);

  const { isCopied, copyText } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  if (documents.length === 0) return null;

  const visibleDocs = documents.slice(0, visibleCount);
  const remaining = documents.length - visibleDocs.length;

  return (
    <section aria-labelledby="galeri-pdf-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="galeri-pdf-heading"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          Galeri dokumen PDF
        </h3>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {documents.length} PDF
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {visibleDocs.map((resource) => {
          const filename = getAssetFilename(resource.url);
          const previewDecision = evaluatePdfPreview(resource);
          const eligibility = getAssetDownloadEligibility(resource);
          const dlState = getDownloadState(resource.id);
          const pageCount = pageCounts[resource.id];
          const isFlagged =
            resource.classification !== 'allowed' &&
            resource.classification !== 'unknown';
          const proxySrc = buildProxyAssetUrl(
            resource.url,
            resolveInspectionId?.(resource) ?? inspectionId,
          );

          return (
            <li
              key={resource.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <div className="relative aspect-[4/3] w-full border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
                {previewDecision.canRenderPdf ? (
                  <button
                    type="button"
                    onClick={() => setInspectedDoc(resource)}
                    aria-label={`Buka pratinjau PDF ${filename}`}
                    className="group relative block h-full w-full text-left focus-visible:outline-none"
                  >
                    <PdfThumbnail
                      src={proxySrc}
                      title={filename}
                      onPageCount={(count) =>
                        setPageCounts((prev) =>
                          prev[resource.id] === count
                            ? prev
                            : { ...prev, [resource.id]: count },
                        )
                      }
                    />
                    <span className="pointer-events-none absolute top-2 left-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-text)] tabular-nums">
                      {pageCount ? `PDF · ${pageCount} hal` : 'PDF'}
                    </span>
                    <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-2 py-1 text-[11px] font-medium text-[var(--color-text)] opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Maximize2 size={12} aria-hidden="true" />
                      <span>Pratinjau</span>
                    </span>
                  </button>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                    <FileText
                      size={20}
                      aria-hidden="true"
                      className="text-[var(--color-text-soft)]"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {previewDecision.note}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
                <div className="min-w-0 space-y-1">
                  <p
                    className="truncate text-sm font-medium text-[var(--color-text)]"
                    title={filename}
                  >
                    {filename}
                  </p>
                  <p className="break-all text-xs text-[var(--color-text-muted)] tabular-nums line-clamp-2">
                    {redactUrlForDisplay(resource.url)}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5 text-[11px] text-[var(--color-text-soft)]">
                    <span className="break-all">{resource.host}</span>
                    <span>{resource.mimeType ?? 'application/pdf'}</span>
                    <span className="tabular-nums">
                      {formatBytes(resource.declaredBytes)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-soft)]">
                    {getObservationSourceLabel(
                      resource,
                      dlState.status === 'downloaded',
                    )}
                  </p>

                  <AssetDownloadStatus state={dlState} />
                </div>

                <AssetCardActions
                  eligibleForDownload={eligibility.eligible}
                  isDownloading={dlState.status === 'downloading'}
                  isCopied={isCopied(resource.id)}
                  onDownload={() => {
                    void downloadResource(resource, filename);
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
                />
              </div>
            </li>
          );
        })}
      </ul>

      {remaining > 0 ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + INITIAL_DOC_BATCH)}
            className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tampilkan PDF lainnya ({remaining} tersisa)
          </button>
        </div>
      ) : null}

      {inspectedDoc ? (
        <Modal
          open={Boolean(inspectedDoc)}
          onClose={() => setInspectedDoc(null)}
          title={getAssetFilename(inspectedDoc.url)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setInspectedDoc(null)}
                className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Tutup
              </button>
              <ExternalLinkAction
                direct
                url={inspectedDoc.url}
                label="Buka PDF di tab baru"
                variant="primary"
              />
            </>
          }
        >
          <PdfViewerSurface
            src={buildProxyAssetUrl(
              inspectedDoc.url,
              resolveInspectionId?.(inspectedDoc) ?? inspectionId,
            )}
            title={getAssetFilename(inspectedDoc.url)}
            compactHeight
          />
        </Modal>
      ) : null}
    </section>
  );
}
