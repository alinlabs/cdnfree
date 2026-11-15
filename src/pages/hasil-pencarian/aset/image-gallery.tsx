import { useEffect, useRef, useState } from 'react';
import { Bookmark, ImageOff } from 'lucide-react';
import { useBookmarks } from '../../../hooks/use-bookmarks';
import { useInView } from '../../../hooks/use-in-view';
import { useResilientImage } from '../../../hooks/use-resilient-image';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateImagePreview,
  formatCompactAssetBadge,
  getAssetFilename,
  getImageFormatLabel,
  isAssetOverInlineLimit,
  isUnverifiedAsset,
} from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { resolveCopyableMediaUrl } from '../../../utils/local-media';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { requestAppFullscreen } from '../media-player/media-fullscreen';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { AssetCardMenu } from './asset-card-menu';
import { AssetInfoModal } from './asset-info-modal';

interface ImageGalleryProps {
  inspectionId: string;
  images: ResourceRecord[];
  sourcePageUrl?: string;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onOpenFullView: (resourceId: string) => void;
}

const INITIAL_IMAGE_BATCH = 24;

function LazyImageCard({
  resource,
  targetSid,
  filename,
  formatLabel,
  cornerBadge,
  fileSizeLabel,
  isMenuOpen,
  menuAlignClass,
  bookmarked,
  eligibility,
  dlState,
  copied,
  onOpenFullView,
  onToggleBookmark,
  onToggleMenu,
  onOpenInfo,
  onCopy,
  onDownload,
  containerRef,
}: {
  resource: ResourceRecord;
  targetSid: string;
  filename: string;
  formatLabel: string;
  cornerBadge: string;
  fileSizeLabel: string | null;
  isMenuOpen: boolean;
  menuAlignClass: string;
  bookmarked: boolean;
  eligibility: ReturnType<typeof getAssetDownloadEligibility>;
  dlState: ReturnType<ReturnType<typeof useResourceDownloads>['getDownloadState']>;
  copied: boolean;
  onOpenFullView: () => void;
  onToggleBookmark: () => void;
  onToggleMenu: () => void;
  onOpenInfo: () => void;
  onCopy: () => void;
  onDownload: () => void;
  containerRef: (node: HTMLDivElement | null) => void;
}) {
  const { ref, inView } = useInView();
  const { activeSrc, hasExhausted, advanceFallback } = useResilientImage(
    resource,
    targetSid,
  );

  const previewDecision = evaluateImagePreview(resource);
  const overLimit = isAssetOverInlineLimit(resource);
  const unverified = isUnverifiedAsset(resource);
  const showLiveImg =
    previewDecision.canRenderImg && !overLimit && !hasExhausted && Boolean(activeSrc);

  return (
    <li
      ref={ref}
      className={`group/card relative aspect-square min-w-0 ${isMenuOpen ? 'z-30' : 'z-0'}`}
    >
      <button
        type="button"
        onClick={onOpenFullView}
        aria-label={`Buka tampilan penuh ${filename}`}
        title={`Tampilan penuh: ${filename}`}
        className="relative block h-full w-full cursor-pointer overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-checker-bg)] bg-[radial-gradient(var(--color-checker-dot)_1px,transparent_1px)] [background-size:12px_12px]"
      >
        {showLiveImg && inView && activeSrc ? (
          <img
            key={activeSrc}
            src={activeSrc}
            alt={filename}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={advanceFallback}
            className="block h-full w-full object-cover"
          />
        ) : showLiveImg ? (
          <div className="h-full w-full bg-[var(--color-surface-subtle)]" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-[var(--color-surface-subtle)] p-2 text-center">
            <ImageOff
              size={18}
              aria-hidden="true"
              className="text-[var(--color-text-soft)]"
            />
            <p className="mt-1.5 hidden text-[11px] leading-snug text-[var(--color-text-muted)] sm:block">
              {overLimit
                ? 'Melebihi 5 MiB — buka di tab baru'
                : hasExhausted
                  ? 'Gagal dimuat'
                  : previewDecision.note}
            </p>
          </div>
        )}

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-[30%] bg-gradient-to-b from-black/60 via-black/25 to-transparent transition-opacity duration-150 ${
            isMenuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          }`}
        />

        <span
          className={`pointer-events-none absolute top-1.5 left-1.5 z-10 max-w-[calc(100%-3.5rem)] truncate text-[10px] font-medium text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] tabular-nums transition-opacity duration-150 sm:top-2 sm:left-2.5 sm:max-w-[calc(100%-4.5rem)] sm:text-[11px] ${
            isMenuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          }`}
        >
          <span className="sm:hidden">{formatLabel}</span>
          <span className="hidden sm:inline">{cornerBadge}</span>
        </span>

        {unverified ? (
          <span className="pointer-events-none absolute right-1.5 bottom-1.5 z-10 max-w-[calc(100%-0.75rem)] truncate rounded-[2px] bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            belum terverifikasi
          </span>
        ) : fileSizeLabel ? (
          <>
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[30%] bg-gradient-to-t from-black/60 via-black/25 to-transparent transition-opacity duration-150 sm:hidden ${
                isMenuOpen
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
              }`}
            />
            <span
              className={`pointer-events-none absolute bottom-1.5 left-1.5 z-10 max-w-[calc(100%-0.75rem)] truncate text-[10px] font-medium text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] tabular-nums transition-opacity duration-150 sm:hidden ${
                isMenuOpen
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
              }`}
            >
              {fileSizeLabel}
            </span>
          </>
        ) : null}
      </button>

      <div
        className={`absolute top-1 right-1 z-20 flex items-center gap-0.5 transition-opacity duration-150 sm:top-2 sm:right-2 sm:gap-1 ${
          isMenuOpen
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover/card:opacity-100 group-hover/card:pointer-events-auto group-focus-within/card:opacity-100 group-focus-within/card:pointer-events-auto'
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark();
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
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-[color,transform] duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-[var(--color-amber)] sm:h-7 sm:w-7 ${
            bookmarked
              ? 'text-[var(--color-amber)]'
              : 'text-white/90 hover:text-white'
          }`}
        >
          <Bookmark
            size={16}
            aria-hidden="true"
            className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${bookmarked ? 'fill-current' : ''}`}
          />
        </button>

        <AssetCardMenu
          filename={filename}
          isOpen={isMenuOpen}
          alignClassName={menuAlignClass}
          menuTitle="Opsi gambar"
          eligibleForDownload={eligibility.eligible}
          downloadState={dlState}
          copied={copied}
          onToggle={onToggleMenu}
          onOpenInfo={onOpenInfo}
          onCopy={onCopy}
          onDownload={onDownload}
          containerRef={containerRef}
          triggerSizeClass="h-6 w-6 sm:h-7 sm:w-7"
        />
      </div>
    </li>
  );
}

export function ImageGallery({
  inspectionId,
  images,
  sourcePageUrl,
  resolveInspectionId,
  onOpenFullView,
}: ImageGalleryProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_IMAGE_BATCH);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [infoResource, setInfoResource] = useState<ResourceRecord | null>(null);
  const activeMenuContainerRef = useRef<HTMLDivElement | null>(null);

  const { isBookmarked, toggleResource } = useBookmarks();
  const { isCopied, copyText } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  useEffect(() => {
    setOpenMenuId(null);
    setInfoResource(null);
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
          Galeri foto
        </h3>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {images.length} foto
        </span>
      </div>

      {images.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
          Tidak ada gambar yang ditemukan atau cocok dengan filter aktif.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
            {visibleImages.map((resource, index) => {
              const filename = getAssetFilename(resource.url);
              const formatLabel = getImageFormatLabel(resource);
              const cornerBadge = formatCompactAssetBadge(
                formatLabel,
                resource.declaredBytes,
              );
              const fileSizeLabel =
                typeof resource.declaredBytes === 'number' &&
                Number.isFinite(resource.declaredBytes) &&
                resource.declaredBytes >= 0
                  ? formatBytes(resource.declaredBytes)
                  : null;
              const isMenuOpen = openMenuId === resource.id;
              const mobileCol = index % 3;
              const desktopCol = index % 4;
              const mobileAlignClass =
                mobileCol === 0
                  ? '-left-14'
                  : mobileCol === 1
                    ? '-right-20'
                    : 'right-0';
              const desktopAlignClass =
                desktopCol <= 1
                  ? 'sm:left-0 sm:right-auto'
                  : 'sm:left-auto sm:right-0';
              const targetSid = resolveInspectionId?.(resource) ?? inspectionId;

              return (
                <LazyImageCard
                  key={resource.id}
                  resource={resource}
                  targetSid={targetSid}
                  filename={filename}
                  formatLabel={formatLabel}
                  cornerBadge={cornerBadge}
                  fileSizeLabel={fileSizeLabel}
                  isMenuOpen={isMenuOpen}
                  menuAlignClass={`${mobileAlignClass} ${desktopAlignClass}`}
                  bookmarked={isBookmarked(resource.url)}
                  eligibility={getAssetDownloadEligibility(resource)}
                  dlState={getDownloadState(resource.id)}
                  copied={isCopied(resource.id)}
                  onOpenFullView={() => {
                    setOpenMenuId(null);
                    requestAppFullscreen();
                    onOpenFullView(resource.id);
                  }}
                  onToggleBookmark={() => toggleResource(resource, sourcePageUrl)}
                  onToggleMenu={() =>
                    setOpenMenuId((prev) =>
                      prev === resource.id ? null : resource.id,
                    )
                  }
                  onOpenInfo={() => {
                    setOpenMenuId(null);
                    setInfoResource(resource);
                  }}
                  onCopy={() => {
                    void copyText(
                      resolveCopyableMediaUrl(resource.url),
                      resource.id,
                    );
                  }}
                  onDownload={() => {
                    void downloadResource(resource, filename);
                  }}
                  containerRef={(node) => {
                    if (isMenuOpen) {
                      activeMenuContainerRef.current = node;
                    }
                  }}
                />
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

      <AssetInfoModal
        resource={infoResource}
        kind="image"
        eligibleForDownload={
          infoResource ? getAssetDownloadEligibility(infoResource).eligible : false
        }
        downloadState={
          infoResource
            ? getDownloadState(infoResource.id)
            : { status: 'idle' }
        }
        copied={infoResource ? isCopied(infoResource.id) : false}
        onCopy={() => {
          if (!infoResource) return;
          void copyText(
            resolveCopyableMediaUrl(infoResource.url),
            infoResource.id,
          );
        }}
        onDownload={() => {
          if (!infoResource) return;
          void downloadResource(infoResource, getAssetFilename(infoResource.url));
        }}
        onClose={() => setInfoResource(null)}
      />
    </section>
  );
}
