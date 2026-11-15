import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hasOpenModalDialog,
  isEditableKeyboardTarget,
  resolveVideoShortcutAction,
} from '../media-player/video-shortcuts';

interface UseVideoMiniCardShortcutsOptions {
  isSeekVolumeTarget: boolean;
  isDownloadTarget: boolean;
  canDownload: boolean;
  isDownloading: boolean;
  onSeekBy: (deltaSeconds: number) => void;
  onChangeVolumeBy: (delta: number) => void;
  onDownload: () => void;
}

export function useVideoMiniCardShortcuts({
  isSeekVolumeTarget,
  isDownloadTarget,
  canDownload,
  isDownloading,
  onSeekBy,
  onChangeVolumeBy,
  onDownload,
}: UseVideoMiniCardShortcutsOptions) {
  const [shortcutHud, setShortcutHud] = useState<string | null>(null);
  const hudTimerRef = useRef<number | null>(null);

  const showShortcutHud = useCallback((label: string) => {
    setShortcutHud(label);
    if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      hudTimerRef.current = null;
      setShortcutHud(null);
    }, 950);
  }, []);

  useEffect(() => {
    return () => {
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isSeekVolumeTarget && !isDownloadTarget) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (hasOpenModalDialog(document) || isEditableKeyboardTarget(event.target)) {
        return;
      }

      const action = resolveVideoShortcutAction(event, 'mini-card');
      if (!action) return;

      if (action.type === 'download') {
        if (!isDownloadTarget) return;
        event.preventDefault();
        event.stopPropagation();
        if (canDownload && !isDownloading) {
          showShortcutHud('Mengunduh...');
          onDownload();
        }
        return;
      }

      if (!isSeekVolumeTarget) return;

      if (action.type === 'seek') {
        event.preventDefault();
        onSeekBy(action.deltaSeconds);
      } else if (action.type === 'volume') {
        event.preventDefault();
        onChangeVolumeBy(action.delta);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canDownload,
    isDownloadTarget,
    isDownloading,
    isSeekVolumeTarget,
    onChangeVolumeBy,
    onDownload,
    onSeekBy,
    showShortcutHud,
  ]);

  return { shortcutHud, showShortcutHud };
}
