import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchCapturedAssets } from '../../../services/inspection-service';
import type { InspectionResult, ResourceRecord } from '../../../types/inspection';
import { deduplicateResources } from '../../../utils/asset-explorer';
import { waitForNextPaint } from '../web/collect-frame-sources';
import type { TabWebHandle } from '../web/tab-web';
import type { ResultsTabKey } from './results-navigation';
import {
  collectRuntimeAndCapturedAssets,
  shouldCollectLiveRuntimeAssets,
} from './workspace-route-state';

export function useLiveAssetCollection(params: {
  result: InspectionResult | null;
  activeTab: ResultsTabKey;
  activeTabRef: RefObject<ResultsTabKey>;
  loading: boolean;
  isReinspecting: boolean;
  tabWebRef: RefObject<TabWebHandle | null>;
}) {
  const {
    result,
    activeTab,
    activeTabRef,
    loading,
    isReinspecting,
    tabWebRef,
  } = params;

  const [capturedResources, setCapturedResources] = useState<ResourceRecord[]>([]);
  const [deepCollectedId, setDeepCollectedId] = useState<string | null>(null);
  const [isDeepCollectingAssets, setIsDeepCollectingAssets] = useState(false);

  const captureTimerRef = useRef<number | null>(null);
  const captureAbortRef = useRef<AbortController | null>(null);

  const mergeCaptured = useCallback((incoming: ResourceRecord[]) => {
    if (incoming.length === 0) return;
    setCapturedResources((prev) => deduplicateResources([...incoming, ...prev]));
  }, []);

  const refreshCapturedAssets = useCallback(
    async (sessionId: string) => {
      captureAbortRef.current?.abort();
      const controller = new AbortController();
      captureAbortRef.current = controller;
      const latest = await fetchCapturedAssets(sessionId, controller.signal);
      if (controller.signal.aborted) return;
      mergeCaptured(latest);
    },
    [mergeCaptured],
  );

  const collectAllLiveAssets = useCallback(
    async (sessionId: string) => {
      setIsDeepCollectingAssets(true);
      try {
        const gathered = await collectRuntimeAndCapturedAssets({
          sessionId,
          waitForSources: tabWebRef.current?.waitForAndCollectSources,
          fetchCaptured: fetchCapturedAssets,
          options: {
            triggerLazyScroll: activeTabRef.current === 'aset',
            muteMedia: activeTabRef.current === 'aset',
          },
        });
        mergeCaptured(gathered);
        setDeepCollectedId(sessionId);
      } finally {
        setIsDeepCollectingAssets(false);
      }
    },
    [activeTabRef, mergeCaptured, tabWebRef],
  );

  const scheduleCaptureRefresh = useCallback(
    (sessionId: string) => {
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
      captureTimerRef.current = window.setTimeout(() => {
        captureTimerRef.current = null;
        void refreshCapturedAssets(sessionId);
      }, 350);
    },
    [refreshCapturedAssets],
  );

  useEffect(() => {
    setCapturedResources([]);
    if (captureTimerRef.current !== null) {
      window.clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    captureAbortRef.current?.abort();
    if (result?.id) {
      void refreshCapturedAssets(result.id);
    }
  }, [result?.id, refreshCapturedAssets]);

  useEffect(() => {
    if (activeTab !== 'aset' || loading || isReinspecting || !result) return;
    const sessionId = result.id;
    if (!shouldCollectLiveRuntimeAssets(result)) {
      setDeepCollectedId(sessionId);
      return;
    }
    if (deepCollectedId === sessionId) {
      void refreshCapturedAssets(sessionId);
      return;
    }

    let cancelled = false;
    setIsDeepCollectingAssets(true);
    void (async () => {
      try {
        await waitForNextPaint();
        if (cancelled) return;
        const gathered = await collectRuntimeAndCapturedAssets({
          sessionId,
          waitForSources: tabWebRef.current?.waitForAndCollectSources,
          fetchCaptured: fetchCapturedAssets,
          options: { triggerLazyScroll: true, muteMedia: true },
          isCancelled: () => cancelled,
        });
        if (!cancelled) {
          mergeCaptured(gathered);
        }
      } finally {
        if (!cancelled) {
          setDeepCollectedId(sessionId);
          setIsDeepCollectingAssets(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      setIsDeepCollectingAssets(false);
    };
  }, [
    activeTab,
    loading,
    isReinspecting,
    result,
    deepCollectedId,
    refreshCapturedAssets,
    mergeCaptured,
    tabWebRef,
  ]);

  useEffect(() => {
    return () => {
      captureAbortRef.current?.abort();
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
    };
  }, []);

  const isCollectingAssets =
    isDeepCollectingAssets ||
    (activeTab === 'aset' &&
      !loading &&
      !isReinspecting &&
      Boolean(result) &&
      shouldCollectLiveRuntimeAssets(result) &&
      deepCollectedId !== result?.id);

  return {
    capturedResources,
    mergeCaptured,
    setDeepCollectedId,
    collectAllLiveAssets,
    scheduleCaptureRefresh,
    isCollectingAssets,
  };
}
