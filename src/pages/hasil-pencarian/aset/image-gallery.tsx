import { useEffect, useRef, useState } from 'react';
import { Bookmark, ImageOff } from 'lucide-react';
import { useBookmarks } from '../../../hooks/use-bookmarks';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateImagePreview,
  formatCompactAssetBadge,
  getAssetFilename,
  getImageFormatLabel,
} from '../../../utils/asset-explorer';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { AssetCardMenu } from './asset-card-menu';

interface ImageGalleryProps {
  inspectionId: string;
  images: ResourceRecord[];
  sourcePageUrl?: string;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onOpenFullView: (index: number) => void;
}

const INITIAL_IMAGE_BATCH = 24;

export function ImageGallery({
  inspectionId,
  images,
  sourcePageUrl,
  resolveInspectionId,
  onOpenFullView,
}: ImageGalleryProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_IMAGE_BATCH);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const activeMenuContainerRef = useRef<HTMLDivElement | null>(null);

  const { isBookmarked, toggleResource } = useBookmarks();
  const { isCopied, copyText } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  useEffect(() => {
    setOpenMenuId(null);
  }, [inspectionId]);

  useEffect(() => {
    if (!openMenuId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        activeMenuContainerRef.current &&
        !activeMenuContainerRef.current.contains(event.target as Node)
      ) {
        setOpenMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenMenuId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const visibleImages = images.slice(0, visibleCount);
  const remaining = images.length - visibleImages.length;

  return (
    <section aria-labelledby="galeri-gambar-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="galeri-gambar-heading"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          Galeri gambar
        </h3>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {images.length} gambar
        </span>
      </div>

      {images.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
          Tidak ada gambar yang ditemukan atau cocok dengan filter aktif.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
            {visibleImages.map((resource, index) => {
              const filename = getAssetFilename(resource.url);
              const formatLabel = getImageFormatLabel(resource);
              const cornerBadge = formatCompactAssetBadge(
                formatLabel,
                resource.declaredBytes,
              );
              const previewDecision = evaluateImagePreview(resource);
              const hasFailed = Boolean(failedIds[resource.id]);
              const showLiveImg = previewDecision.canRenderImg && !hasFailed;
              const eligibility = getAssetDownloadEligibility(resource);
              const dlState = getDownloadState(resource.id);
              const isMenuOpen = openMenuId === resource.id;
              const bookmarked = isBookmarked(resource.url);
              const colPos = index % 4;
              const menuAlignClass =
                colPos === 0
                  ? 'left-0'
                  : colPos === 1
                    ? 'right-0 sm:left-0 sm:right-auto'
                    : colPos === 2
                      ? 'left-0 sm:left-auto sm:right-0'
                      : 'right-0';

              return (
                <li
                  key={resource.id}
                  className={`relative aspect-square min-w-0 ${isMenuOpen ? 'z-30' : 'z-0'}`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenFullView(index)}
                    aria-label={`Buka tampilan penuh ${filename}`}
                    title={`Tampilan penuh: ${filename}`}
                    className="relative block h-full w-full cursor-pointer overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-checker-bg)] bg-[radial-gradient(var(--color-checker-dot)_1px,transparent_1px)] [background-size:12px_12px] transition-colors duration-150 hover:border-[var(--color-amber)]"
                  >
                    {showLiveImg ? (
                      <img
                        src={buildProxyAssetUrl(
                          resource.url,
                          resolveInspectionId?.(resource) ?? inspectionId,
                        )}
                        alt={filename}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedIds((prev) => ({
                            ...prev,
                            [resource.id]: true,
                          }))
                        }
                        className="h-full w-full object-contain p-1.5 sm:p-2"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center bg-[var(--color-surface-subtle)] p-2 text-center">
                        <ImageOff
                          size={18}
                          aria-hidden="true"
                          className="text-[var(--color-text-soft)]"
                        />
                        <p className="mt-1.5 hidden text-[11px] leading-snug text-[var(--color-text-muted)] sm:block">
                          {hasFailed ? 'Gagal dimuat' : previewDecision.note}
                        </p>
                      </div>
                    )}

                    <span className="pointer-events-none absolute top-2 left-2 max-w-[calc(100%-4.5rem)] truncate rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-text)] tabular-nums">
                      {cornerBadge}
                    </span>
                  </button>

                  <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleResource(resource, sourcePageUrl);
                      }}
                      aria-label={
                        bookmarked
                          ? `Hapus ${filename} dari markah`
                          : `Simpan ${filename} ke markah`
                      }
                      aria-pressed={bookmarked}
                      title={
                        bookmarked ? 'Tersimpan di markah (hapus)' : 'Simpan ke markah'
                      }
                      className={`inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-[var(--radius-sm)] border transition-colors duration-150 ${
                        bookmarked
                          ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      <Bookmark
                        size={13}
                        aria-hidden="true"
                        className={bookmarked ? 'fill-current' : ''}
                      />
                    </button>

                    <AssetCardMenu
                      resource={resource}
                      filename={filename}
                      formatLabel={formatLabel}
                      isOpen={isMenuOpen}
                      alignClassName={menuAlignClass}
                      menuTitle="Info & aksi gambar"
                      eligibleForDownload={eligibility.eligible}
                      downloadState={dlState}
                      copied={isCopied(resource.id)}
                      isBookmarked={bookmarked}
                      onToggleBookmark={() =>
                        toggleResource(resource, sourcePageUrl)
                      }
                      onToggle={() =>
                        setOpenMenuId((prev) =>
                          prev === resource.id ? null : resource.id,
                        )
                      }
                      onDownload={() => {
                        void downloadResource(resource, filename);
                      }}
                      onCopy={() => {
                        void copyText(resource.url, resource.id);
                      }}
                      onOpenFullView={() => {
                        setOpenMenuId(null);
                        onOpenFullView(index);
                      }}
                      containerRef={(node) => {
                        if (isMenuOpen) {
                          activeMenuContainerRef.current = node;
                        }
                      }}
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
                onClick={() => setVisibleCount((prev) => prev + INITIAL_IMAGE_BATCH)}
                className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Tampilkan gambar lainnya ({remaining} tersisa)
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
