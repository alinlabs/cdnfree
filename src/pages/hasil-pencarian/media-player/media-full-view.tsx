import { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBookmarks } from '../../../hooks/use-bookmarks';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetFilename,
  getImageFormatLabel,
} from '../../../utils/asset-explorer';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { CustomImageViewer } from './custom-image-viewer';
import { CustomVideoPlayer } from './custom-video-player';
import { MediaPlayerHeader } from './media-player-header';
import {
  buildMediaSubtitleMeta,
  clampMediaIndex,
  getNextMediaIndex,
  getPrevMediaIndex,
} from './media-player-utils';

export type MediaPlayerKind = 'image' | 'video';

export interface MediaFullViewProps {
  inspectionId: string;
  mediaKind: MediaPlayerKind;
  items: ResourceRecord[];
  activeIndex: number;
  sourcePageUrl?: string;
  backLabel?: string;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onChangeIndex: (nextIndex: number) => void;
  onClose: () => void;
}

export function MediaFullView({
  inspectionId,
  mediaKind,
  items,
  activeIndex,
  sourcePageUrl,
  backLabel,
  resolveInspectionId,
  onChangeIndex,
  onClose,
}: MediaFullViewProps) {
  const safeIndex = clampMediaIndex(activeIndex, items.length);
  const resource = items[safeIndex];

  const { isBookmarked, toggleResource } = useBookmarks();
  const { isCopied, copyText, resetCopyFeedback } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  useEffect(() => {
    resetCopyFeedback();
  }, [resource?.id, resetCopyFeedback]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const goPrev = useCallback(
    () => onChangeIndex(getPrevMediaIndex(safeIndex, items.length)),
    [items.length, onChangeIndex, safeIndex],
  );
  const goNext = useCallback(
    () => onChangeIndex(getNextMediaIndex(safeIndex, items.length)),
    [items.length, onChangeIndex, safeIndex],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.fullscreenElement) return;
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft' && items.length > 1) {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight' && items.length > 1) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, items.length, onClose]);

  if (!resource) return null;

  const filename = getAssetFilename(resource.url);
  const formatLabel =
    mediaKind === 'image'
      ? getImageFormatLabel(resource)
      : (resource.mimeType ?? 'Video');
  const eligibility = getAssetDownloadEligibility(resource);
  const dlState = getDownloadState(resource.id);
  const copied = isCopied(resource.id);
  const isDownloading = dlState.status === 'downloading';
  const targetInspectionId = resolveInspectionId?.(resource) ?? inspectionId;

  const subtitle = buildMediaSubtitleMeta({
    host: resource.host,
    formatLabel,
    declaredBytes: resource.declaredBytes,
    index: safeIndex,
    total: items.length,
    statusMessage: dlState.message,
  });

  const handleCopy = () => {
    void copyText(resource.url, resource.id);
  };

  const handleDownload = () => {
    if (!eligibility.eligible || isDownloading) return;
    void downloadResource(resource, filename);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Tampilan penuh ${mediaKind === 'video' ? 'video' : 'gambar'}: ${filename}`}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]"
    >
      <MediaPlayerHeader
        filename={filename}
        subtitle={subtitle}
        totalItems={items.length}
        canDownload={eligibility.eligible}
        isDownloading={isDownloading}
        copied={copied}
        isBookmarked={isBookmarked(resource.url)}
        onToggleBookmark={() => toggleResource(resource, sourcePageUrl)}
        backLabel={backLabel}
        onPrev={goPrev}
        onNext={goNext}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onClose={onClose}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {mediaKind === 'video' ? (
          <CustomVideoPlayer
            inspectionId={targetInspectionId}
            resource={resource}
            filename={filename}
            canDownload={eligibility.eligible}
            isDownloading={isDownloading}
            copied={copied}
            onDownload={handleDownload}
            onCopy={handleCopy}
          />
        ) : (
          <CustomImageViewer
            inspectionId={targetInspectionId}
            resource={resource}
            filename={filename}
            canDownload={eligibility.eligible}
            isDownloading={isDownloading}
            copied={copied}
            onDownload={handleDownload}
            onCopy={handleCopy}
          />
        )}

        {items.length > 1 ? (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Sebelumnya"
              className="absolute top-1/2 left-2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text)] shadow-md transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] sm:hidden"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Berikutnya"
              className="absolute top-1/2 right-2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text)] shadow-md transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] sm:hidden"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
