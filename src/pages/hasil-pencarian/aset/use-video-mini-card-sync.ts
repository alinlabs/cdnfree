import { useEffect, useRef, useState, type RefObject } from 'react';
import { smartCacheDb, type SmartCacheEntry } from '../../../services/smart-cache-db';
import { triggerVideoHydration } from '../../../services/smart-cache-hydrator';
import { resolveCachedBlobPlaybackUrl } from '../../../services/smart-cache-storage';
import { videoLoadScheduler } from '../../../services/video-load-scheduler';
import {
  getCanonicalVideoKey,
  videoPlaybackStore,
  type VideoPlaybackSnapshot,
  type VideoSourceMode,
} from '../../../services/video-playback-store';
import type { ResourceRecord } from '../../../types/inspection';
import {
  resolveVideoSourcePlan,
  type VideoSourcePlan,
} from '../../../utils/video-source-strategy';

interface UseVideoMiniCardSyncOptions {
  resource: ResourceRecord;
  inspectionId: string;
  inView: boolean;
  isPlaying: boolean;
  isBookmarked: boolean;
  hasStartedRef: RefObject<boolean>;
  videoRef: RefObject<HTMLVideoElement | null>;
  isActivePlayer: boolean;
  onActivatePlayer: () => void;
  onResumeFromStore: (snapshot: VideoPlaybackSnapshot, shouldAutoPlay: boolean) => void;
}

export function useVideoMiniCardSync({
  resource,
  inspectionId,
  inView,
  isPlaying,
  isBookmarked,
  hasStartedRef,
  videoRef,
  isActivePlayer,
  onActivatePlayer,
  onResumeFromStore,
}: UseVideoMiniCardSyncOptions) {
  const smartCacheKey = getCanonicalVideoKey(resource);
  const [cacheEntry, setCacheEntry] = useState<SmartCacheEntry | null>(() =>
    smartCacheDb.getEntrySync(smartCacheKey),
  );
  const [cachedMediaUrl, setCachedMediaUrl] = useState<string | null>(null);
  const [cachedPoster, setCachedPoster] = useState<string | null>(() =>
    smartCacheDb.getPosterSync(smartCacheKey),
  );
  const [userEngaged, setUserEngaged] = useState(false);
  const [slotGranted, setSlotGranted] = useState(false);
  const [snapshot, setSnapshot] = useState<VideoPlaybackSnapshot | null>(() =>
    videoPlaybackStore.getSnapshot(smartCacheKey),
  );

  const slotReleaseRef = useRef<(() => void) | null>(null);
  const onResumeRef = useRef(onResumeFromStore);
  const onActivateRef = useRef(onActivatePlayer);
  onResumeRef.current = onResumeFromStore;
  onActivateRef.current = onActivatePlayer;

  const suppressPauseSyncRef = useRef(false);
  const playbackTimerRef = useRef<number | null>(null);
  const hydratedTriggeredRef = useRef(false);

  // Sync SmartCache metadata & poster DB
  useEffect(() => {
    let cancelled = false;
    void smartCacheDb.init().then(async () => {
      if (cancelled) return;
      const entry = smartCacheDb.getEntrySync(smartCacheKey);
      setCacheEntry(entry);
      const poster = smartCacheDb.getPosterSync(smartCacheKey);
      if (poster) setCachedPoster(poster);
      if (entry?.status === 'complete' && !hasStartedRef.current) {
        const url = await resolveCachedBlobPlaybackUrl(entry);
        if (!cancelled) setCachedMediaUrl(url);
      } else if (entry?.status !== 'complete') {
        setCachedMediaUrl(null);
      }
    });

    const unsub = smartCacheDb.subscribe(() => {
      const entry = smartCacheDb.getEntrySync(smartCacheKey);
      setCacheEntry(entry);
      const poster = smartCacheDb.getPosterSync(smartCacheKey);
      setCachedPoster(poster);
      if (entry?.status === 'complete') {
        if (!hasStartedRef.current && !isPlaying) {
          void resolveCachedBlobPlaybackUrl(entry).then((url) => {
            if (!cancelled) setCachedMediaUrl(url);
          });
        }
      } else {
        setCachedMediaUrl(null);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [hasStartedRef, isPlaying, smartCacheKey]);

  // Subscribe to playback snapshots (Card <-> Full View sync)
  useEffect(() => {
    const initial = videoPlaybackStore.getSnapshot(smartCacheKey);
    setSnapshot(initial);

    const unsub = videoPlaybackStore.subscribe(smartCacheKey, (nextSnap) => {
      setSnapshot(nextSnap);
      // Only sync back into this card when this card is not currently the active inline player
      const v = videoRef.current;
      const cardActivelyPlaying = Boolean(v && !v.paused && isActivePlayer);
      if (!cardActivelyPlaying && nextSnap.currentTime > 0.15) {
        const canAutoResume =
          nextSnap.wasPlaying && inView && !videoLoadScheduler.isBackgroundPaused();
        onResumeRef.current(nextSnap, canAutoResume);
      }
    });
    return unsub;
  }, [inView, isActivePlayer, smartCacheKey, videoRef]);

  // Request throttled preload slot from VideoLoadScheduler when entering viewport
  useEffect(() => {
    if (!inView || userEngaged || hasStartedRef.current) {
      return;
    }
    if (cachedPoster || cacheEntry?.status === 'complete') {
      return;
    }

    let cancelled = false;
    let safetyTimer: number | null = null;

    void videoLoadScheduler
      .requestPreloadSlot(smartCacheKey, {
        priority: 1,
        onAbort: () => {
          if (!cancelled) setSlotGranted(false);
        },
      })
      .then((lease) => {
        if (cancelled || lease.aborted) {
          lease.release();
          return;
        }
        slotReleaseRef.current = lease.release;
        setSlotGranted(true);
        safetyTimer = window.setTimeout(() => {
          lease.release();
          slotReleaseRef.current = null;
        }, 4000);
      });

    return () => {
      cancelled = true;
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      slotReleaseRef.current?.();
      slotReleaseRef.current = null;
      videoLoadScheduler.cancel(smartCacheKey);
    };
  }, [cacheEntry?.status, cachedPoster, hasStartedRef, inView, smartCacheKey, userEngaged]);

  // Coordinate active player priority with VideoLoadScheduler
  useEffect(() => {
    if (isActivePlayer && isPlaying) {
      videoLoadScheduler.setActivePlayer(smartCacheKey);
      return () => {
        videoLoadScheduler.setActivePlayer(null);
      };
    }
  }, [isActivePlayer, isPlaying, smartCacheKey]);

  const effectiveOfflineCache =
    cacheEntry?.status === 'complete' && (!hasStartedRef.current || Boolean(cachedMediaUrl));

  const sourcePlan: VideoSourcePlan = resolveVideoSourcePlan({
    resource,
    inspectionId,
    smartCacheKey,
    isCachedOffline: effectiveOfflineCache,
    cachedMediaUrl,
    snapshot,
  });

  // Trigger background SmartCache hydration after >= 1.5s of active playback
  useEffect(() => {
    if (!isPlaying || hydratedTriggeredRef.current || cacheEntry?.status === 'complete') {
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      return;
    }
    playbackTimerRef.current = window.setTimeout(() => {
      playbackTimerRef.current = null;
      hydratedTriggeredRef.current = true;
      void triggerVideoHydration({
        resource,
        fetchUrl: sourcePlan.streamSrc,
        isHls: sourcePlan.isHls,
        isBookmarked,
        urlsToAlias: [resource.url, sourcePlan.streamSrc],
      });
    }, 1500);

    return () => {
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [
    cacheEntry?.status,
    isBookmarked,
    isPlaying,
    resource,
    sourcePlan.isHls,
    sourcePlan.streamSrc,
  ]);

  const releasePreloadSlot = () => {
    slotReleaseRef.current?.();
    slotReleaseRef.current = null;
  };

  const persistPoster = (dataUrl: string) => {
    setCachedPoster(dataUrl);
    void smartCacheDb.savePoster(smartCacheKey, dataUrl);
  };

  const capturePoster = (video: HTMLVideoElement) => {
    if (cachedPoster || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    try {
      const targetWidth = Math.min(480, video.videoWidth);
      const targetHeight = Math.max(
        1,
        Math.round((video.videoHeight / video.videoWidth) * targetWidth),
      );
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
      persistPoster(canvas.toDataURL('image/jpeg', 0.72));
    } catch {
      // Cross-origin canvas tainting is expected for non-CORS streams
    }
  };

  const saveSnapshot = (
    patch: Partial<Omit<VideoPlaybackSnapshot, 'key'>>,
    immediate = false,
  ) => {
    videoPlaybackStore.saveSnapshot(smartCacheKey, patch, { immediate, notify: false });
  };

  const prepareZoomToFullView = (
    currentTime: number,
    duration: number,
    wasPlaying: boolean,
    isMuted: boolean,
    activeMode: VideoSourceMode,
  ) => {
    suppressPauseSyncRef.current = true;
    videoPlaybackStore.saveSnapshot(
      smartCacheKey,
      {
        currentTime,
        duration,
        wasPlaying,
        isMuted,
        preferredSourceMode: activeMode,
      },
      { immediate: true, notify: false },
    );
    window.setTimeout(() => {
      suppressPauseSyncRef.current = false;
    }, 150);
  };

  const markDirectFailed = () => {
    videoPlaybackStore.markDirectFailed(smartCacheKey);
  };

  const canLoadMetadata =
    userEngaged || slotGranted || hasStartedRef.current || cacheEntry?.status === 'complete';

  return {
    smartCacheKey,
    cacheEntry,
    cachedPoster,
    sourcePlan,
    canLoadMetadata,
    userEngaged,
    suppressPauseSyncRef,
    markEngaged: () => setUserEngaged(true),
    releasePreloadSlot,
    capturePoster,
    saveSnapshot,
    prepareZoomToFullView,
    markDirectFailed,
  };
}
