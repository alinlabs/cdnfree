import { useEffect, useRef, useState } from 'react';
import { useBookmarks } from '../../../hooks/use-bookmarks';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetFilename,
  isPlayableVideoCandidate,
} from '../../../utils/asset-explorer';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { VideoMiniCard } from './video-mini-card';

interface VideoGalleryProps {
  inspectionId: string;
  videos: ResourceRecord[];
  sourcePageUrl?: string;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onMarkVideoFailed?: (resourceId: string) => void;
  onOpenFullView: (resourceId: string) => void;
}

const INITIAL_VIDEO_BATCH = 12;

export function VideoGallery({
  inspectionId,
  videos,
  sourcePageUrl,
  resolveInspectionId,
  onMarkVideoFailed,
  onOpenFullView,
}: VideoGalleryProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VIDEO_BATCH);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const activeMenuContainerRef = useRef<HTMLDivElement | null>(null);

  const { isBookmarked, toggleResource } = useBookmarks();
  const { isCopied, copyText } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  useEffect(() => {
    setOpenMenuId(null);
    setActivePlayerId(null);
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

  const playableVideos = videos.filter((resource) =>
    isPlayableVideoCandidate(resource),
  );
  const visibleVideos = playableVideos.slice(0, visibleCount);
  const remaining = playableVideos.length - visibleVideos.length;

  return (
    <section aria-labelledby="galeri-video-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="galeri-video-heading"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          Galeri video
        </h3>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {playableVideos.length} video
        </span>
      </div>

      {playableVideos.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
          Tidak ada video yang valid atau dapat diputar untuk filter aktif.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleVideos.map((resource) => {
              const filename = getAssetFilename(resource.url);
              const isMenuOpen = openMenuId === resource.id;

              return (
                <VideoMiniCard
                  key={resource.id}
                  inspectionId={resolveInspectionId?.(resource) ?? inspectionId}
                  resource={resource}
                  isActivePlayer={activePlayerId === resource.id}
                  isMenuOpen={isMenuOpen}
                  hasFailed={false}
                  downloadState={getDownloadState(resource.id)}
                  copied={isCopied(resource.id)}
                  isBookmarked={isBookmarked(resource.url)}
                  onToggleBookmark={() => toggleResource(resource, sourcePageUrl)}
                  onActivatePlayer={() => setActivePlayerId(resource.id)}
                  onMarkFailed={() => onMarkVideoFailed?.(resource.id)}
                  onToggleMenu={() =>
                    setOpenMenuId((prev) =>
                      prev === resource.id ? null : resource.id,
                    )
                  }
                  onCloseMenu={() => setOpenMenuId(null)}
                  onDownload={() => {
                    void downloadResource(resource, filename);
                  }}
                  onCopy={() => {
                    void copyText(resource.url, resource.id);
                  }}
                  onOpenFullView={() => {
                    setActivePlayerId(null);
                    onOpenFullView(resource.id);
                  }}
                  menuContainerRef={(node) => {
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
                onClick={() => setVisibleCount((prev) => prev + INITIAL_VIDEO_BATCH)}
                className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Tampilkan video lainnya ({remaining} tersisa)
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
