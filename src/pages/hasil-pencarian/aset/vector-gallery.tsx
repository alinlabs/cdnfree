import { useEffect, useRef, useState } from 'react';
import { Bookmark, Shapes } from 'lucide-react';
import { useBookmarks } from '../../../hooks/use-bookmarks';
import { useInView } from '../../../hooks/use-in-view';
import { useResilientImage } from '../../../hooks/use-resilient-image';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateImagePreview,
  formatCompactAssetBadge,
  getAssetFilename,
  isAssetOverInlineLimit,
  isUnverifiedAsset,
} from '../../../utils/asset-explorer';
import { resolveCopyableMediaUrl } from '../../../utils/local-media';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { requestAppFullscreen } from '../media-player/media-fullscreen';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { AssetCardMenu } from './asset-card-menu';
import { AssetInfoModal } from './asset-info-modal';

interface VectorGalleryProps {
  inspectionId: string;
  vectors: ResourceRecord[];
  sourcePageUrl?: string;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onOpenFullView: (resourceId: string) => void;
}

const INITIAL_VECTOR_BATCH = 24;

function VectorCard({
  resource,
  targetSid,
  sourcePageUrl,
  isMenuOpen,
  menuAlignClass,
  bookmarked,
  dlState,
  copied,
  eligibility,
  onToggleBookmark,
  onToggleMenu,
  onOpenInfo,
  onCopy,
  onDownload,
  onOpenFullView,
  containerRef,
}: {
  resource: ResourceRecord;
  targetSid: string;
  sourcePageUrl?: string;
  isMenuOpen: boolean;
  menuAlignClass: string;
  bookmarked: boolean;
  dlState: ReturnType<ReturnType<typeof useResourceDownloads>['getDownloadState']>;
  copied: boolean;
  eligibility: ReturnType<typeof getAssetDownloadEligibility>;
  onToggleBookmark: () => void;
  onToggleMenu: () => void;
  onOpenInfo: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onOpenFullView: () => void;
  containerRef: (node: HTMLDivElement | null) => void;
}) {
  const { ref, inView } = useInView();
  const { activeSrc, hasExhausted, advanceFallback } = useResilientImage(
    resource,
    targetSid,
  );

  const filename = getAssetFilename(resource.url);
  const cornerBadge = formatCompactAssetBadge('SVG', resource.declaredBytes);
  const previewDecision = evaluateImagePreview(resource);
  const overLimit = isAssetOverInlineLimit(resource);
  const unverified = isUnverifiedAsset(resource);
  const canRenderImg =
    previewDecision.canRenderImg && !overLimit && !hasExhausted && Boolean(activeSrc);

  return (
    <li
      ref={ref}
      className={`group/card relative aspect-square min-w-0 ${isMenuOpen ? 'z-30' : 'z-0'}`}
    >
      <button
        type="button"
        onClick={() => {
          requestAppFullscreen();
          onOpenFullView();
        }}
        aria-label={`Buka tampilan penuh vektor ${filename}`}
        title={`Tampilan penuh: ${filename}`}
        className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-checker-bg)] bg-[radial-gradient(var(--color-checker-dot)_1px,transparent_1px)] [background-size:12px_12px] p-3"
      >
        {canRenderImg && inView && activeSrc ? (
          <img
            key={activeSrc}
            src={activeSrc}
            alt={filename}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={advanceFallback}
            className="block max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Shapes
              size={20}
              aria-hidden="true"
              className="text-[var(--color-text-soft)]"
            />
            <span className="mt-1.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
              {overLimit
                ? 'Melebihi 5 MiB'
                : hasExhausted
                  ? 'Unduh SVG asli'
                  : previewDecision.note || 'SVG'}
            </span>
          </div>
        )}

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-[30%] bg-gradient-to-b from-black/55 via-black/20 to-transparent transition-opacity duration-150 ${
            isMenuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          }`}
        />

        <span
          className={`pointer-events-none absolute top-1.5 left-1.5 z-10 max-w-[calc(100%-3.5rem)] truncate text-[10px] font-medium text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] tabular-nums transition-opacity duration-150 sm:top-2 sm:left-2.5 sm:text-[11px] ${
            isMenuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          }`}
        >
          {cornerBadge}
        </span>

        {unverified ? (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-10 max-w-[calc(100%-0.75rem)] truncate text-[10px] font-medium text-[var(--color-amber-strong)] bg-[var(--color-surface)]/90 px-1.5 py-0.5 rounded-[2px]">
            belum terverifikasi
          </span>
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
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-[color,transform] duration-150 hover:scale-110 sm:h-7 sm:w-7 ${
            bookmarked ? 'text-[var(--color-amber)]' : 'text-white/90 hover:text-white'
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
          menuTitle="Opsi vektor"
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

export function VectorGallery({
  inspectionId,
  vectors,
  sourcePageUrl,
  resolveInspectionId,
  onOpenFullView,
}: VectorGalleryProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VECTOR_BATCH);
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

  if (vectors.length === 0) return null;

  const visibleVectors = vectors.slice(0, visibleCount);
  const remaining = vectors.length - visibleVectors.length;

  return (
    <section aria-labelledby="galeri-vektor-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="galeri-vektor-heading"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          Vektor & SVG
        </h3>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {vectors.length} vektor
        </span>
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
        {visibleVectors.map((resource, index) => {
          const filename = getAssetFilename(resource.url);
          const isMenuOpen = openMenuId === resource.id;
          const mobileCol = index % 3;
          const desktopCol = index % 6;
          const menuAlignClass = `${
            mobileCol === 0 ? '-left-14' : mobileCol === 1 ? '-right-20' : 'right-0'
          } ${desktopCol <= 2 ? 'sm:left-0 sm:right-auto' : 'sm:left-auto sm:right-0'}`;
          const targetSid = resolveInspectionId?.(resource) ?? inspectionId;

          return (
            <VectorCard
              key={resource.id}
              resource={resource}
              targetSid={targetSid}
              sourcePageUrl={sourcePageUrl}
              isMenuOpen={isMenuOpen}
              menuAlignClass={menuAlignClass}
              bookmarked={isBookmarked(resource.url)}
              dlState={getDownloadState(resource.id)}
              copied={isCopied(resource.id)}
              eligibility={getAssetDownloadEligibility(resource)}
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
              onOpenFullView={() => {
                setOpenMenuId(null);
                onOpenFullView(resource.id);
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
            onClick={() => setVisibleCount((prev) => prev + INITIAL_VECTOR_BATCH)}
            className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tampilkan vektor lainnya ({remaining} tersisa)
          </button>
        </div>
      ) : null}

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
