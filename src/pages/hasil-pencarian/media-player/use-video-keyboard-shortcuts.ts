import { useEffect } from 'react';
import { MEDIA_ZOOM_STEP, stepMediaZoom } from './media-player-utils';
import {
  isEditableKeyboardTarget,
  resolveVideoShortcutAction,
} from './video-shortcuts';

interface UseVideoKeyboardShortcutsOptions {
  totalItems: number;
  canDownload: boolean;
  isDownloading: boolean;
  togglePlay: () => void;
  toggleMute: () => void;
  seekBy: (deltaSeconds: number) => void;
  changeVolumeBy: (delta: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDownload: () => void;
  onRevealControls?: () => void;
  zoom: number;
  applyZoom: (nextZoom: number) => void;
  resetTransform: () => void;
  rotate90: () => void;
  toggleFlipX: () => void;
  toggleFlipY: () => void;
}

export function useVideoKeyboardShortcuts({
  totalItems,
  canDownload,
  isDownloading,
  togglePlay,
  toggleMute,
  seekBy,
  changeVolumeBy,
  onPrev,
  onNext,
  onDownload,
  onRevealControls,
  zoom,
  applyZoom,
  resetTransform,
  rotate90,
  toggleFlipX,
  toggleFlipY,
}: UseVideoKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const action = resolveVideoShortcutAction(event, 'full-view', MEDIA_ZOOM_STEP);
      if (!action) return;

      event.preventDefault();

      switch (action.type) {
        case 'download':
          event.stopPropagation();
          if (canDownload && !isDownloading) {
            onDownload();
          }
          onRevealControls?.();
          break;
        case 'prev-video':
          if (totalItems > 1) {
            onPrev?.();
          }
          onRevealControls?.();
          break;
        case 'next-video':
          if (totalItems > 1) {
            onNext?.();
          }
          onRevealControls?.();
          break;
        case 'seek':
          seekBy(action.deltaSeconds);
          onRevealControls?.();
          break;
        case 'volume':
          changeVolumeBy(action.delta);
          onRevealControls?.();
          break;
        case 'toggle-play':
          togglePlay();
          onRevealControls?.();
          break;
        case 'toggle-mute':
          toggleMute();
          onRevealControls?.();
          break;
        case 'zoom':
          applyZoom(stepMediaZoom(zoom, action.delta));
          onRevealControls?.();
          break;
        case 'reset-transform':
          resetTransform();
          onRevealControls?.();
          break;
        case 'rotate-90':
          rotate90();
          onRevealControls?.();
          break;
        case 'toggle-flip-x':
          toggleFlipX();
          onRevealControls?.();
          break;
        case 'toggle-flip-y':
          toggleFlipY();
          onRevealControls?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    applyZoom,
    canDownload,
    changeVolumeBy,
    isDownloading,
    onDownload,
    onNext,
    onPrev,
    onRevealControls,
    resetTransform,
    rotate90,
    seekBy,
    toggleFlipX,
    toggleFlipY,
    toggleMute,
    togglePlay,
    totalItems,
    zoom,
  ]);
}
