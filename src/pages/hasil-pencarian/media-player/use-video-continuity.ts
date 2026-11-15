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
import {
  resolveVideoSourcePlan,
  type VideoSourcePlan,
} from '../../../utils/video-source-strategy';

interface UseVideoContinuityOptions {
  resource: ResourceRecord;
  inspectionId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  isBookmarked: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  onSyncTime: (time: number) => void;
}

export function useVideoContinuity({
  resource,
  inspectionId,
  videoRef,
  isPlaying,
  isBookmarked,
  currentTime,
  duration,
  playbackRate,
  volume,
  isMuted,
  onSyncTime,
}: UseVideoContinuityOptions) {
  const smartCacheKey = getCanonicalVideoKey(resource);
  const [cacheEntry, setCacheEntry] = useState<SmartCacheEntry | null>(() =>
    smartCacheDb.getEntrySync(smartCacheKey),
  );
  const [cachedMediaUrl, setCachedMediaUrl] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<VideoPlaybackSnapshot | null>(() =>
    videoPlaybackStore.getSnapshot(smartCacheKey),
  );

  const pendingResumeTimeRef = useRef<number | null>(
    initialSnapshot && initialSnapshot.currentTime > 0.15
      ? initialSnapshot.currentTime
      : null,
  );
  const lastThrottleFlushRef = useRef(0);
  const hydrationTimerRef = useRef<number | null>(null);
  const hydratedTriggeredRef = useRef(false);

  const latestRef = useRef({
    key: smartCacheKey,
    currentTime,
    duration,
    isPlaying,
    playbackRate,
    volume,
    isMuted,
    mode: 'direct' as VideoSourceMode,
  });

  latestRef.current.currentTime = currentTime;
  latestRef.current.duration = duration;
  latestRef.current.isPlaying = isPlaying;
  latestRef.current.playbackRate = playbackRate;
  latestRef.current.volume = volume;
  latestRef.current.isMuted = isMuted;

  // Pause background grid preloads while Full View is open
  useEffect(() => {
    videoLoadScheduler.setFullViewActive(true);
    return () => {
      videoLoadScheduler.setFullViewActive(false);
    };
  }, []);

  const mountedOfflineRef = useRef(cacheEntry?.status === 'complete');
  if (!isPlaying && !hydratedTriggeredRef.current && cacheEntry?.status === 'complete') {
    mountedOfflineRef.current = true;
  } else if (cacheEntry?.status !== 'complete') {
    mountedOfflineRef.current = false;
  }

  // Sync SmartCache metadata for active resource
  useEffect(() => {
    let cancelled = false;
    hydratedTriggeredRef.current = false;
    const snap = videoPlaybackStore.getSnapshot(smartCacheKey);
    setInitialSnapshot(snap);
    pendingResumeTimeRef.current =
      snap && snap.currentTime > 0.15 ? snap.currentTime : null;

    void smartCacheDb.init().then(async () => {
      if (cancelled) return;
      const entry = smartCacheDb.getEntrySync(smartCacheKey);
      setCacheEntry(entry);
      if (entry?.status === 'complete' && !hydratedTriggeredRef.current) {
        mountedOfflineRef.current = true;
        const url = await resolveCachedBlobPlaybackUrl(entry);
        if (!cancelled) setCachedMediaUrl(url);
      } else if (entry?.status !== 'complete') {
        mountedOfflineRef.current = false;
        setCachedMediaUrl(null);
      }
    });

    const unsub = smartCacheDb.subscribe(() => {
      const entry = smartCacheDb.getEntrySync(smartCacheKey);
      setCacheEntry(entry);
      if (entry?.status === 'complete') {
        if (!latestRef.current.isPlaying && !hydratedTriggeredRef.current) {
          mountedOfflineRef.current = true;
          void resolveCachedBlobPlaybackUrl(entry).then((url) => {
            if (!cancelled) setCachedMediaUrl(url);
          });
        }
      } else {
        mountedOfflineRef.current = false;
        setCachedMediaUrl(null);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [smartCacheKey]);

  const sourcePlan: VideoSourcePlan = resolveVideoSourcePlan({
    resource,
    inspectionId,
    smartCacheKey,
    isCachedOffline: mountedOfflineRef.current,
    cachedMediaUrl,
    snapshot: initialSnapshot,
  });

  latestRef.current.key = smartCacheKey;
  latestRef.current.mode = sourcePlan.initialMode;

  // Flush snapshot on unmount or resource switch (Prev / Next / Close)
  useEffect(() => {
    const activeKey = smartCacheKey;
    return () => {
      const snap = latestRef.current;
      if (snap.key === activeKey && (snap.currentTime > 0 || snap.isPlaying)) {
        videoPlaybackStore.saveSnapshot(
          activeKey,
          {
            currentTime: snap.currentTime,
            duration: snap.duration,
            wasPlaying: snap.isPlaying,
            playbackRate: snap.playbackRate,
            volume: snap.volume,
            isMuted: snap.isMuted,
            preferredSourceMode: snap.mode,
          },
          { immediate: true, notify: true, isUnmountFlush: true },
        );
      }
    };
  }, [smartCacheKey]);

  const flushPlaybackSnapshot = useCallback(
    (
      overrides?: Partial<Omit<VideoPlaybackSnapshot, 'key'>>,
      options: { immediate?: boolean; notify?: boolean } = {},
    ) => {
      const v = videoRef.current;
      const time =
        overrides?.currentTime ??
        (v && Number.isFinite(v.currentTime) ? v.currentTime : latestRef.current.currentTime);
      const dur =
        overrides?.duration ??
        (v && Number.isFinite(v.duration) && v.duration > 0
          ? v.duration
          : latestRef.current.duration);
      const playing =
        overrides?.wasPlaying ?? (v ? !v.paused && !v.ended : latestRef.current.isPlaying);

      videoPlaybackStore.saveSnapshot(
        smartCacheKey,
        {
          currentTime: time,
          duration: dur,
          wasPlaying: playing,
          playbackRate: overrides?.playbackRate ?? latestRef.current.playbackRate,
          volume: overrides?.volume ?? latestRef.current.volume,
          isMuted: overrides?.isMuted ?? latestRef.current.isMuted,
          preferredSourceMode: overrides?.preferredSourceMode ?? latestRef.current.mode,
        },
        options,
      );
    },
    [smartCacheKey, videoRef],
  );

  const flushThrottledTime = useCallback(
    (time: number, dur: number) => {
      const now = Date.now();
      if (now - lastThrottleFlushRef.current < 400) return;
      lastThrottleFlushRef.current = now;
      flushPlaybackSnapshot(
        { currentTime: time, duration: dur, wasPlaying: true },
        { immediate: false, notify: false },
      );
    },
    [flushPlaybackSnapshot],
  );

  const applyPendingResumeSeek = useCallback(
    (video: HTMLVideoElement): boolean => {
      const target = pendingResumeTimeRef.current;
      if (target === null || target <= 0.15) {
        pendingResumeTimeRef.current = null;
        return false;
      }

      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      let clamped = dur > 0 ? Math.min(target, Math.max(0, dur - 0.1)) : target;

      if (video.seekable.length > 0) {
        const minSeek = video.seekable.start(0);
        const maxSeek = video.seekable.end(video.seekable.length - 1);
        if (maxSeek > minSeek) {
          clamped = Math.min(Math.max(clamped, minSeek), maxSeek);
        }
      } else if (dur <= 0) {
        // Defer seek until duration / seekable range is available (Safari/WebKit guard)
        return false;
      }

      try {
        video.currentTime = clamped;
        onSyncTime(clamped);
        pendingResumeTimeRef.current = null;
        return true;
      } catch {
        return false;
      }
    },
    [onSyncTime],
  );

  // Trigger background SmartCache hydration after >= 1.5s of playback in Full View
  useEffect(() => {
    if (!isPlaying || hydratedTriggeredRef.current || cacheEntry?.status === 'complete') {
      if (hydrationTimerRef.current !== null) {
        window.clearTimeout(hydrationTimerRef.current);
        hydrationTimerRef.current = null;
      }
      return;
    }

    hydrationTimerRef.current = window.setTimeout(() => {
      hydrationTimerRef.current = null;
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
      if (hydrationTimerRef.current !== null) {
        window.clearTimeout(hydrationTimerRef.current);
        hydrationTimerRef.current = null;
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

  return {
    smartCacheKey,
    cacheEntry,
    initialSnapshot,
    initialResumeTime: pendingResumeTimeRef.current ?? 0,
    sourcePlan,
    applyPendingResumeSeek,
    flushPlaybackSnapshot,
    flushThrottledTime,
    markDirectFailed: () => videoPlaybackStore.markDirectFailed(smartCacheKey),
  };
}
