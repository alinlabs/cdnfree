import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { LoadingState } from '../../../components/loading-state';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetSectionVisibility,
  isPlayableVideoCandidate,
} from '../../../utils/asset-explorer';
import {
  partitionAssetsByCategory,
  resolveFullViewIndex,
  type AssetKindFilter,
  type MediaFullViewQueryState,
} from './asset-filters';
import { DocumentGallery } from './document-gallery';
import { ImageGallery } from './image-gallery';
import { MediaFullView } from '../media-player';
import { ResourceTable } from './resource-table';
import { VideoGallery } from './video-gallery';

interface TabAsetProps {
  inspectionId: string;
  sourcePageUrl?: string;
  totalCount: number;
  filteredResources: ResourceRecord[];
  kindFilter: AssetKindFilter;
  hasFormatFilter?: boolean;
  batchStatus: string | null;
  fullView: MediaFullViewQueryState | null;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  isBulkLoading?: boolean;
  onOpenFullView: (kind: 'image' | 'video', itemKey: string) => void;
  onChangeFullViewItem: (itemKey: string) => void;
  onCloseFullView: () => void;
  onResetFilters?: () => void;
}

const OTHER_PAGE_SIZE = 25;

export function TabAset({
  inspectionId,
  sourcePageUrl,
  totalCount,
  filteredResources,
  kindFilter,
  hasFormatFilter = false,
  batchStatus,
  fullView,
  resolveInspectionId,
  isBulkLoading = false,
  onOpenFullView,
  onChangeFullViewItem,
  onCloseFullView,
  onResetFilters,
}: TabAsetProps) {
  const [otherPage, setOtherPage] = useState(1);

  useEffect(() => {
    setOtherPage(1);
  }, [filteredResources, kindFilter]);

  const { imageAssets, videoAssets, pdfAssets, otherAssets } = useMemo(
    () => partitionAssetsByCategory(filteredResources),
    [filteredResources],
  );

  const validVideoAssets = useMemo(
    () =>
      videoAssets.filter((resource) => isPlayableVideoCandidate(resource)),
    [videoAssets],
  );

  const totalOtherPages = Math.max(
    1,
    Math.ceil(otherAssets.length / OTHER_PAGE_SIZE),
  );
  const safeOtherPage = Math.min(otherPage, totalOtherPages);
  const otherStartIndex = (safeOtherPage - 1) * OTHER_PAGE_SIZE;
  const pagedOtherAssets = otherAssets.slice(
    otherStartIndex,
    otherStartIndex + OTHER_PAGE_SIZE,
  );

  const { showImageSection, showVideoSection, showOtherSection } =
    getAssetSectionVisibility(
      kindFilter,
      {
        image: imageAssets.length,
        video: validVideoAssets.length,
        other: otherAssets.length,
      },
      hasFormatFilter,
    );
  const shouldRenderVideoSection =
    showVideoSection && (validVideoAssets.length > 0 || kindFilter === 'video');

  const fullViewItems =
    fullView?.kind === 'image'
      ? imageAssets
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

      {totalCount === 0 && isBulkLoading ? (
        <LoadingState label="Memeriksa beberapa tautan secara paralel dan mengumpulkan aset..." rows={4} />
      ) : totalCount === 0 ? (
        <EmptyState
          title="Tidak ada aset statis ditemukan"
          description="Dokumen HTML ini tidak mencantumkan referensi gambar, media, skrip, atau stylesheet yang dapat diekstraksi secara statis."
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
          {showImageSection ? (
            <ImageGallery
              inspectionId={inspectionId}
              images={imageAssets}
              sourcePageUrl={sourcePageUrl}
              resolveInspectionId={resolveInspectionId}
              onOpenFullView={(index) => {
                const target = imageAssets[index];
                if (target) {
                  onOpenFullView('image', target.id);
                }
              }}
            />
          ) : null}

          {shouldRenderVideoSection ? (
            <VideoGallery
              inspectionId={inspectionId}
              videos={validVideoAssets}
              sourcePageUrl={sourcePageUrl}
              resolveInspectionId={resolveInspectionId}
              onOpenFullView={(resourceId) => {
                onOpenFullView('video', resourceId);
              }}
            />
          ) : null}

          {pdfAssets.length > 0 ? (
            <DocumentGallery
              inspectionId={inspectionId}
              documents={pdfAssets}
              resolveInspectionId={resolveInspectionId}
            />
          ) : null}

          {showOtherSection ? (
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
                  {otherAssets.length} aset
                  {totalOtherPages > 1
                    ? ` · Halaman ${safeOtherPage} dari ${totalOtherPages}`
                    : ''}
                </span>
              </div>

              {otherAssets.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  Tidak ada audio, skrip, stylesheet, font, atau sumber aset lainnya pada filter ini.
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
