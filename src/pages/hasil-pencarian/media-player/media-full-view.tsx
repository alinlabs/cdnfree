import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBookmarks } from '../../../hooks/use-bookmarks';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetFilename,
  getImageFormatLabel,
} from '../../../utils/asset-explorer';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { resolveCopyableMediaUrl } from '../../../utils/local-media';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { CustomImageViewer } from './custom-image-viewer';
import { CustomVideoPlayer } from './custom-video-player';
import { exitAppFullscreen } from './media-fullscreen';
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
  const enteredFullscreenRef = useRef(
    typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const idleTimerRef = useRef<number | null>(null);

  const [isChromeVisible, setIsChromeVisible] = useState(true);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [isControlsHovered, setIsControlsHovered] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [hasMediaError, setHasMediaError] = useState(false);

  const { isBookmarked, toggleResource } = useBookmarks();
  const { isCopied, copyText, resetCopyFeedback } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  const handleClose = useCallback(() => {
    enteredFullscreenRef.current = false;
    exitAppFullscreen();
    onCloseRef.current();
  }, []);

  const isVideoMode = mediaKind === 'video';
  const pinChrome =
    isHeaderHovered ||
    isControlsHovered ||
    isScrubbing ||
    isSpeedMenuOpen ||
    hasMediaError;
  const effectiveChromeVisible = pinChrome || isChromeVisible;

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleIdleHide = useCallback(() => {
    clearIdleTimer();
    if (pinChrome) return;
    idleTimerRef.current = window.setTimeout(() => {
      setIsChromeVisible(false);
      idleTimerRef.current = null;
    }, 2400);
  }, [clearIdleTimer, pinChrome]);

  const revealChrome = useCallback(() => {
    setIsChromeVisible(true);
    scheduleIdleHide();
  }, [scheduleIdleHide]);

  useEffect(() => {
    if (pinChrome) {
      clearIdleTimer();
      setIsChromeVisible(true);
      return;
    }
    scheduleIdleHide();
    return clearIdleTimer;
  }, [clearIdleTimer, pinChrome, scheduleIdleHide]);

  useEffect(() => {
    resetCopyFeedback();
    setHasMediaError(false);
    setIsSpeedMenuOpen(false);
    setIsScrubbing(false);
    setIsChromeVisible(true);
    scheduleIdleHide();
  }, [mediaKind, resource?.id, resetCopyFeedback, scheduleIdleHide]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        enteredFullscreenRef.current = true;
      } else if (enteredFullscreenRef.current) {
        enteredFullscreenRef.current = false;
        onCloseRef.current();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.body.style.overflow = prevOverflow;
      exitAppFullscreen();
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
      revealChrome();
      if (event.key === 'Escape') {
        if (document.fullscreenElement) return;
        event.preventDefault();
        handleClose();
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
  }, [goNext, goPrev, handleClose, items.length, revealChrome]);

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
    void copyText(resolveCopyableMediaUrl(resource.url), resource.id);
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
      onPointerMove={revealChrome}
      onPointerDown={revealChrome}
      className="dark fixed inset-0 z-50 flex flex-col bg-[#09090b] text-[#f3f2ef]"
    >
      <MediaPlayerHeader
        filename={filename}
        subtitle={subtitle}
        totalItems={items.length}
        canDownload={eligibility.eligible}
        isDownloading={isDownloading}
        copied={copied}
        isBookmarked={isBookmarked(resource.url)}
        overlay
        visible={effectiveChromeVisible}
        showItemNav={!isVideoMode}
        onPointerEnter={() => setIsHeaderHovered(true)}
        onPointerLeave={() => setIsHeaderHovered(false)}
        onFocusCapture={revealChrome}
        onToggleBookmark={() => toggleResource(resource, sourcePageUrl)}
        backLabel={backLabel}
        onPrev={goPrev}
        onNext={goNext}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onClose={handleClose}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {mediaKind === 'video' ? (
          <CustomVideoPlayer
            inspectionId={targetInspectionId}
            resource={resource}
            filename={filename}
            allowArrowSeek={items.length <= 1}
            canDownload={eligibility.eligible}
            isDownloading={isDownloading}
            copied={copied}
            controlsVisible={effectiveChromeVisible}
            totalItems={items.length}
            onPrev={goPrev}
            onNext={goNext}
            onControlsPointerEnter={() => setIsControlsHovered(true)}
            onControlsPointerLeave={() => setIsControlsHovered(false)}
            onScrubbingChange={setIsScrubbing}
            onSpeedMenuOpenChange={setIsSpeedMenuOpen}
            onErrorStateChange={setHasMediaError}
            onRevealControls={revealChrome}
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
            controlsVisible={effectiveChromeVisible}
            onControlsPointerEnter={() => setIsControlsHovered(true)}
            onControlsPointerLeave={() => setIsControlsHovered(false)}
            onErrorStateChange={setHasMediaError}
            onRevealControls={revealChrome}
            onDownload={handleDownload}
            onCopy={handleCopy}
          />
        )}

        {!isVideoMode && items.length > 1 ? (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Sebelumnya"
              className={`absolute top-1/2 left-2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#121215]/90 text-white shadow-md transition-[opacity,background-color] duration-200 hover:bg-white/15 sm:hidden ${
                effectiveChromeVisible
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0'
              }`}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Berikutnya"
              className={`absolute top-1/2 right-2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#121215]/90 text-white shadow-md transition-[opacity,background-color] duration-200 hover:bg-white/15 sm:hidden ${
                effectiveChromeVisible
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0'
              }`}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
