import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { LoadingState } from '../../../components/loading-state';
import type {
  ExtractionTelemetry,
  ResourceRecord,
} from '../../../types/inspection';
import {
  getAssetSectionVisibility,
  isUnverifiedAsset,
} from '../../../utils/asset-explorer';
import {
  resolveFullViewIndex,
  type AssetKindFilter,
  type MediaFullViewQueryState,
} from './asset-filters';
import { AudioGallery } from './audio-gallery';
import { DocumentGallery } from './document-gallery';
import {
  MediaGalleriesGrid,
  splitGalleryMedia,
} from './media-galleries-grid';
import { MediaFullView } from '../media-player';
import { ResourceTable } from './resource-table';

interface TabAsetProps {
  inspectionId: string;
  sourcePageUrl?: string;
  totalCount: number;
  filteredResources: ResourceRecord[];
  kindFilter: AssetKindFilter;
  hasFormatFilter?: boolean;
  batchStatus: string | null;
  fullView: MediaFullViewQueryState | null;
  extraction?: ExtractionTelemetry;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  isBulkLoading?: boolean;
  isCollectingAssets?: boolean;
  collectingLabel?: string;
  onOpenFullView: (kind: 'image' | 'video', itemKey: string) => void;
  onChangeFullViewItem: (itemKey: string) => void;
  onCloseFullView: () => void;
  onResetFilters?: () => void;
}

const OTHER_PAGE_SIZE = 25;

const DROP_REASON_LABELS: Record<
  ExtractionTelemetry['dropped'][number]['reason'],
  string
> = {
  unresolvable: 'URL tidak valid',
  scheme: 'skema ditolak',
  duplicate: 'duplikat',
  budget: 'batas anggaran',
};

export function TabAset({
  inspectionId,
  sourcePageUrl,
  totalCount,
  filteredResources,
  kindFilter,
  hasFormatFilter = false,
  batchStatus,
  fullView,
  extraction,
  resolveInspectionId,
  isBulkLoading = false,
  isCollectingAssets = false,
  collectingLabel,
  onOpenFullView,
  onChangeFullViewItem,
  onCloseFullView,
  onResetFilters,
}: TabAsetProps) {
  const [otherPage, setOtherPage] = useState(1);

  useEffect(() => {
    setOtherPage(1);
  }, [filteredResources, kindFilter]);

  const {
    imageAssets,
    vectorAssets,
    allImageFullViewItems,
    validVideoAssets,
    nonPlayableVideoAssets,
    audioAssets,
    pdfAssets,
    otherAssets,
  } = useMemo(
    () => splitGalleryMedia(filteredResources),
    [filteredResources],
  );

  const effectiveOtherAssets = useMemo(
    () => [...nonPlayableVideoAssets, ...otherAssets],
    [nonPlayableVideoAssets, otherAssets],
  );

  const unverifiedVisibleCount = useMemo(
    () => filteredResources.filter(isUnverifiedAsset).length,
    [filteredResources],
  );

  const totalOtherPages = Math.max(
    1,
    Math.ceil(effectiveOtherAssets.length / OTHER_PAGE_SIZE),
  );
  const safeOtherPage = Math.min(otherPage, totalOtherPages);
  const otherStartIndex = (safeOtherPage - 1) * OTHER_PAGE_SIZE;
  const pagedOtherAssets = effectiveOtherAssets.slice(
    otherStartIndex,
    otherStartIndex + OTHER_PAGE_SIZE,
  );

  const { showImageSection, showVideoSection, showOtherSection } =
    getAssetSectionVisibility(
      kindFilter,
      {
        image: imageAssets.length,
        video: validVideoAssets.length,
        other: effectiveOtherAssets.length,
      },
      hasFormatFilter,
    );

  const shouldRenderImageGallery =
    showImageSection && (imageAssets.length > 0 || (kindFilter === 'image' && vectorAssets.length === 0));
  const shouldRenderVectorGallery = vectorAssets.length > 0;
  const shouldRenderVideoSection =
    showVideoSection && (validVideoAssets.length > 0 || kindFilter === 'video');
  const shouldRenderAudioGallery = audioAssets.length > 0;
  const shouldRenderPdfGallery = pdfAssets.length > 0;
  const shouldRenderOtherSection =
    showOtherSection &&
    (effectiveOtherAssets.length > 0 ||
      (kindFilter !== 'image' && kindFilter !== 'video' && kindFilter !== 'audio'));

  const hasZeroPrimaryMedia =
    imageAssets.length === 0 &&
    vectorAssets.length === 0 &&
    validVideoAssets.length === 0 &&
    audioAssets.length === 0 &&
    pdfAssets.length === 0;

  const fullViewItems =
    fullView?.kind === 'image'
      ? allImageFullViewItems
      : fullView?.kind === 'video'
        ? validVideoAssets
        : [];
  const fullViewIndex =
    fullView && fullViewItems.length > 0
      ? resolveFullViewIndex(fullViewItems, fullView.itemKey)
      : -1;

  return (
    <div
      id="panel-aset"
      role="region"
      aria-label="Aset Manager"
      className="space-y-6"
    >
      {batchStatus ? (
        <p role="status" className="text-xs font-medium text-[var(--color-text-muted)]">
          {batchStatus}
        </p>
      ) : null}

      {!isCollectingAssets && extraction ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-muted)] tabular-nums">
          <span>{extraction.candidates} kandidat</span>
          <span aria-hidden="true">·</span>
          <span>{extraction.deduped} unik</span>
          <span aria-hidden="true">·</span>
          <span>{extraction.verifiedCount} terverifikasi</span>
          {extraction.unverifiedCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[var(--color-amber-strong)]">
                {extraction.unverifiedCount} belum terverifikasi
              </span>
            </>
          ) : null}
          {extraction.dropped.length > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                dilewati:{' '}
                {extraction.dropped
                  .map((item) => `${DROP_REASON_LABELS[item.reason] ?? item.reason} ${item.count}`)
                  .join(', ')}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {!isCollectingAssets && unverifiedVisibleCount > 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3.5 py-2.5 text-xs leading-relaxed text-[var(--color-text-muted)]"
        >
          Sebagian aset (
          <span className="tabular-nums font-medium text-[var(--color-text)]">
            {unverifiedVisibleCount}
          </span>
          ) belum terverifikasi (403 / timeout). Aset tetap ditampilkan agar Anda dapat memeriksa atau membukanya di tab baru.
        </div>
      ) : null}

      {isCollectingAssets ? (
        <LoadingState
          label={
            collectingLabel ||
            (isBulkLoading
              ? 'Memeriksa beberapa tautan secara paralel dan mengumpulkan aset terbaik...'
              : 'Menjalankan halaman secara penuh dan mengumpulkan aset terbaik...')
          }
          rows={5}
        />
      ) : totalCount === 0 ? (
        <EmptyState
          title="Tidak ada aset statis ditemukan"
          description="Halaman ini mungkin dimuat secara dinamis lewat JavaScript atau tidak mencantumkan referensi gambar, vektor, media, atau stylesheet statis."
        />
      ) : filteredResources.length === 0 ? (
        <EmptyState
          title="Tidak ada aset yang cocok"
          description="Ubah kata kunci pencarian atau pilih jenis aset lain untuk melihat hasil."
          action={
            onResetFilters ? (
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex min-h-[36px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Reset filter
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-7">
          {hasZeroPrimaryMedia &&
          effectiveOtherAssets.length > 0 &&
          kindFilter === 'all' &&
          !hasFormatFilter ? (
            <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
              Tidak ada foto, vektor, video, atau audio ditemukan — menampilkan{' '}
              <span className="tabular-nums font-medium text-[var(--color-text)]">
                {effectiveOtherAssets.length}
              </span>{' '}
              sumber aset lainnya.
            </p>
          ) : null}

          <MediaGalleriesGrid
            inspectionId={inspectionId}
            sourcePageUrl={sourcePageUrl}
            imageAssets={imageAssets}
            vectorAssets={vectorAssets}
            validVideoAssets={validVideoAssets}
            showImages={shouldRenderImageGallery}
            showVectors={shouldRenderVectorGallery}
            showVideos={shouldRenderVideoSection}
            resolveInspectionId={resolveInspectionId}
            onOpenFullView={onOpenFullView}
          />

          {shouldRenderAudioGallery ? (
            <AudioGallery
              inspectionId={inspectionId}
              audios={audioAssets}
              resolveInspectionId={resolveInspectionId}
            />
          ) : null}

          {shouldRenderPdfGallery ? (
            <DocumentGallery
              inspectionId={inspectionId}
              documents={pdfAssets}
              resolveInspectionId={resolveInspectionId}
            />
          ) : null}

          {shouldRenderOtherSection ? (
            <section
              aria-labelledby="sumber-aset-lainnya-heading"
              className="space-y-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                  id="sumber-aset-lainnya-heading"
                  className="text-sm font-semibold text-[var(--color-text)]"
                >
                  Sumber aset lainnya
                </h3>
                <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
                  {effectiveOtherAssets.length} aset
                  {totalOtherPages > 1
                    ? ` · Halaman ${safeOtherPage} dari ${totalOtherPages}`
                    : ''}
                </span>
              </div>

              {effectiveOtherAssets.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  Tidak ada skrip, stylesheet, font, atau sumber aset lainnya pada filter ini.
                </p>
              ) : (
                <>
                  <ResourceTable
                    inspectionId={inspectionId}
                    resources={pagedOtherAssets}
                    resolveInspectionId={resolveInspectionId}
                  />

                  {totalOtherPages > 1 ? (
                    <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
                      <button
                        type="button"
                        disabled={safeOtherPage <= 1}
                        onClick={() =>
                          setOtherPage((prev) => Math.max(1, prev - 1))
                        }
                        className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Sebelumnya
                      </button>
                      <button
                        type="button"
                        disabled={safeOtherPage >= totalOtherPages}
                        onClick={() =>
                          setOtherPage((prev) =>
                            Math.min(totalOtherPages, prev + 1),
                          )
                        }
                        className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Berikutnya
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </div>
      )}

      {fullView && fullViewIndex >= 0 ? (
        <MediaFullView
          inspectionId={inspectionId}
          mediaKind={fullView.kind}
          items={fullViewItems}
          activeIndex={fullViewIndex}
          sourcePageUrl={sourcePageUrl}
          resolveInspectionId={resolveInspectionId}
          onChangeIndex={(nextIndex) => {
            const nextItem = fullViewItems[nextIndex];
            if (nextItem) {
              onChangeFullViewItem(nextItem.id);
            }
          }}
          onClose={onCloseFullView}
        />
      ) : null}
    </div>
  );
}
