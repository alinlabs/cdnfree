import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
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
import { isLocalAppMediaUrl } from '../../../utils/local-media';
import {
  resolveVideoSourcePlan,
  type VideoSourcePlan,
} from '../../../utils/video-source-strategy';
import {
  captureThumbnailFromUrl,
  drawVideoFrameToDataUrl,
} from '../../../utils/video-thumbnail-extractor';

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
  const thumbnailFallbackAttemptedRef = useRef(false);
  const thumbnailAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    thumbnailFallbackAttemptedRef.current = false;
    thumbnailAbortRef.current?.abort();
    thumbnailAbortRef.current = null;
    setCachedPoster(smartCacheDb.getPosterSync(smartCacheKey));
  }, [smartCacheKey]);

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

  const persistPoster = useCallback(
    (dataUrl: string) => {
      setCachedPoster(dataUrl);
      void smartCacheDb.savePoster(smartCacheKey, dataUrl);
    },
    [smartCacheKey],
  );

  const requestProxyThumbnailCapture = useCallback(() => {
    if (
      cachedPoster ||
      thumbnailFallbackAttemptedRef.current ||
      sourcePlan.isHls ||
      sourcePlan.isOfflineCached ||
      isLocalAppMediaUrl(resource.url) ||
      !sourcePlan.streamSrc.startsWith('/')
    ) {
      return;
    }

    thumbnailFallbackAttemptedRef.current = true;
    thumbnailAbortRef.current?.abort();
    const controller = new AbortController();
    thumbnailAbortRef.current = controller;

    void captureThumbnailFromUrl(
      smartCacheKey,
      sourcePlan.streamSrc,
      controller.signal,
    ).then((dataUrl) => {
      if (controller.signal.aborted || !dataUrl) return;
      persistPoster(dataUrl);
    });
  }, [
    cachedPoster,
    persistPoster,
    resource.url,
    smartCacheKey,
    sourcePlan.isHls,
    sourcePlan.isOfflineCached,
    sourcePlan.streamSrc,
  ]);

  useEffect(() => {
    return () => {
      thumbnailAbortRef.current?.abort();
      thumbnailAbortRef.current = null;
    };
  }, []);

  const canLoadMetadata =
    userEngaged || slotGranted || hasStartedRef.current || cacheEntry?.status === 'complete';

  // Ensure cross-origin direct video cards still capture thumbnails even when
  // preload="metadata" stalls or skips decoding the initial frame
  useEffect(() => {
    if (
      !inView ||
      !canLoadMetadata ||
      cachedPoster ||
      sourcePlan.isHls ||
      sourcePlan.isOfflineCached ||
      isLocalAppMediaUrl(resource.url)
    ) {
      return;
    }

    const timerId = window.setTimeout(() => {
      requestProxyThumbnailCapture();
    }, 1200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    cachedPoster,
    canLoadMetadata,
    inView,
    requestProxyThumbnailCapture,
    resource.url,
    sourcePlan.isHls,
    sourcePlan.isOfflineCached,
  ]);

  const capturePoster = (video: HTMLVideoElement) => {
    if (cachedPoster) return;
    const res = drawVideoFrameToDataUrl(video);
    if (res.ok) {
      persistPoster(res.dataUrl);
      return;
    }
    if (res.reason === 'tainted') {
      requestProxyThumbnailCapture();
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
        preferredSourceMode: activeMode === 'stream' ? 'direct' : activeMode,
      },
      { immediate: true, notify: false },
    );
    window.setTimeout(() => {
      suppressPauseSyncRef.current = false;
    }, 150);
  };

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
    requestProxyThumbnailCapture,
    saveSnapshot,
    prepareZoomToFullView,
  };
}
