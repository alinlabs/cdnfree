import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useHistory } from '../../../hooks/use-history';
import {
  fetchCapturedAssets,
  getInspectionById,
} from '../../../services/inspection-service';
import type { InspectionResult, ResourceRecord } from '../../../types/inspection';
import { deduplicateResources } from '../../../utils/asset-explorer';
import { formatCleanUrl } from '../../../utils/clean-url';
import { getHostnameSafe } from '../../../utils/inspection-details';
import { normalizeUrlInput } from '../../../utils/normalize-url';
import { parseSingleSearchInput } from '../../../utils/smart-url-parser';
import { waitForNextPaint } from '../web/collect-frame-sources';
import type { TabWebHandle } from '../web/tab-web';
import { runInspectForUrl } from './inspection-actions';
import {
  buildPreservedResultsRoutePath,
  buildResultsRoutePath,
  resolveResultsTabFromPathname,
  type ResultsTabKey,
} from './results-navigation';
import { lookupUrSessionCache, writeUrSessionCache } from './ur-session-cache';

interface ResultsRouteState {
  inspectionId?: string;
  canonicalUrl?: string;
  fromWeb?: boolean;
}

export function useInspectionWorkspace() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { addEntry } = useHistory();

  const routeState = (location.state as ResultsRouteState | null) ?? null;
  const bulkId = searchParams.get('bulk');
  const submittedUrl = bulkId ? null : (searchParams.get('ur') ?? searchParams.get('url'));
  const cleanSubmittedKey = submittedUrl ? formatCleanUrl(submittedUrl) : null;
  const cachedSession = lookupUrSessionCache(cleanSubmittedKey);
  const explicitQueryId = bulkId ? null : searchParams.get('id');
  const inspectionId = bulkId
    ? null
    : (explicitQueryId ?? routeState?.inspectionId ?? cachedSession?.id ?? null);
  const canonicalTargetInput = bulkId
    ? null
    : (routeState?.canonicalUrl ?? cachedSession?.canonicalUrl ?? submittedUrl);

  const resolvedTab = resolveResultsTabFromPathname(location.pathname);
  const activeTab: ResultsTabKey = resolvedTab ?? 'web';
  const canReturnToWeb = Boolean(!bulkId && (activeTab === 'web' || routeState?.fromWeb));

  const [loading, setLoading] = useState(Boolean(inspectionId || submittedUrl));
  const [isReinspecting, setIsReinspecting] = useState(false);
  const [isPreparingAssets, setIsPreparingAssets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [capturedResources, setCapturedResources] = useState<ResourceRecord[]>([]);

  const [hideWebChrome, setHideWebChrome] = useState(true);
  const [quickUrl, setQuickUrl] = useState(canonicalTargetInput ?? '');
  const [quickUrlError, setQuickUrlError] = useState<string | null>(null);
  const [submitNonce, setSubmitNonce] = useState(0);

  const reinspectAbortRef = useRef<AbortController | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const captureAbortRef = useRef<AbortController | null>(null);
  const skipNextFetchRef = useRef<{ id: string; cleanUrl: string } | null>(null);
  const loadedInspectionRef = useRef<{
    id: string;
    cleanUrl: string;
    submitNonce: number;
  } | null>(null);
  const resultRef = useRef<InspectionResult | null>(result);
  resultRef.current = result;
  const previousCleanKeyRef = useRef<string | null>(cleanSubmittedKey);
  const runtimeRedirectCountRef = useRef(0);
  const prepareSeqRef = useRef(0);
  const tabWebRef = useRef<TabWebHandle>(null);
  const activeTabRef = useRef<ResultsTabKey>(activeTab);
  activeTabRef.current = activeTab;
  const routeStateRef = useRef<ResultsRouteState | null>(routeState);
  routeStateRef.current = routeState;
  const locationSearchRef = useRef(location.search);
  locationSearchRef.current = location.search;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const deduplicatedResources = useMemo(
    () =>
      result
        ? deduplicateResources([...result.resources, ...capturedResources])
        : [],
    [result, capturedResources],
  );

  const liveResult = useMemo(
    () =>
      result
        ? {
            ...result,
            resources: deduplicatedResources,
            summary: {
              ...result.summary,
              resourceCount: deduplicatedResources.length,
            },
          }
        : null,
    [result, deduplicatedResources],
  );

  const selectTab = useCallback(
    (
      nextTab: ResultsTabKey,
      overrideParams?: { url?: string | null; id?: string | null },
    ) => {
      const targetUrl =
        overrideParams?.url ?? result?.finalUrl ?? result?.submittedUrl ?? canonicalTargetInput;
      const targetId = overrideParams?.id ?? result?.id ?? inspectionId;
      const hasWebOrigin =
        nextTab === 'web' ||
        activeTabRef.current === 'web' ||
        Boolean(routeStateRef.current?.fromWeb);
      navigate(
        buildResultsRoutePath(nextTab, { url: targetUrl }),
        {
          state: {
            inspectionId: targetId ?? undefined,
            canonicalUrl: targetUrl ?? undefined,
            fromWeb: hasWebOrigin,
          } satisfies ResultsRouteState,
        },
      );
    },
    [
      canonicalTargetInput,
      inspectionId,
      navigate,
      result?.finalUrl,
      result?.id,
      result?.submittedUrl,
    ],
  );

  const replaceCurrentTabParams = useCallback(
    (destinationUrl: string, id: string) => {
      writeUrSessionCache(destinationUrl, id);
      const currentTab = activeTabRef.current;
      navigateRef.current(
        buildPreservedResultsRoutePath(
          currentTab,
          destinationUrl,
          locationSearchRef.current,
        ),
        {
          replace: true,
          state: {
            inspectionId: id,
            canonicalUrl: destinationUrl,
            fromWeb:
              currentTab === 'web' ||
              Boolean(routeStateRef.current?.fromWeb),
          } satisfies ResultsRouteState,
        },
      );
    },
    [],
  );

  const refreshCapturedAssets = useCallback(async (sessionId: string) => {
    captureAbortRef.current?.abort();
    const controller = new AbortController();
    captureAbortRef.current = controller;
    const latest = await fetchCapturedAssets(sessionId, controller.signal);
    if (controller.signal.aborted) return;
    if (latest.length > 0) {
      setCapturedResources((prev) => deduplicateResources([...latest, ...prev]));
    }
  }, []);

  const collectAllLiveAssets = useCallback(async (sessionId: string) => {
    const [serverCaptured, domResources] = await Promise.all([
      fetchCapturedAssets(sessionId),
      tabWebRef.current?.waitForAndCollectSources() ?? Promise.resolve([]),
    ]);
    setCapturedResources((prev) =>
      deduplicateResources([...serverCaptured, ...domResources, ...prev]),
    );
  }, []);

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
    if (activeTab === 'aset' && result?.id) {
      void refreshCapturedAssets(result.id);
    }
  }, [activeTab, result?.id, refreshCapturedAssets]);

  useEffect(() => {
    return () => {
      prepareSeqRef.current += 1;
      reinspectAbortRef.current?.abort();
      captureAbortRef.current?.abort();
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setQuickUrl(result?.finalUrl ?? canonicalTargetInput ?? '');
  }, [result?.finalUrl, canonicalTargetInput]);

  const recordHistory = useCallback(
    (inspected: InspectionResult) => {
      const destinationUrl = inspected.finalUrl || inspected.submittedUrl;
      addEntry({
        id: inspected.id,
        url: destinationUrl,
        displayUrl: destinationUrl,
        host: getHostnameSafe(destinationUrl),
        title: inspected.page.title,
        inspectedAt: inspected.summary.inspectedAt,
        status: 'completed',
      });
    },
    [addEntry],
  );

  const recordHistoryRef = useRef(recordHistory);
  recordHistoryRef.current = recordHistory;

  useEffect(() => {
    if (previousCleanKeyRef.current !== cleanSubmittedKey) {
      previousCleanKeyRef.current = cleanSubmittedKey;
      setHideWebChrome(true);
    }

    const skipped = skipNextFetchRef.current;
    if (
      skipped &&
      skipped.id === inspectionId &&
      skipped.cleanUrl === cleanSubmittedKey
    ) {
      skipNextFetchRef.current = null;
      setLoading(false);
      setError(null);
      return;
    }

    const alreadyLoaded = loadedInspectionRef.current;
    if (
      alreadyLoaded &&
      resultRef.current &&
      alreadyLoaded.submitNonce === submitNonce &&
      alreadyLoaded.cleanUrl === cleanSubmittedKey &&
      (!inspectionId || alreadyLoaded.id === inspectionId)
    ) {
      setLoading(false);
      setError(null);
      return;
    }

    prepareSeqRef.current += 1;
    setIsPreparingAssets(false);
    reinspectAbortRef.current?.abort();
    reinspectAbortRef.current = null;
    setIsReinspecting(false);

    if (!inspectionId && !submittedUrl) {
      loadedInspectionRef.current = null;
      setLoading(false);
      setResult(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError(null);

    async function load() {
      if (inspectionId) {
        const byId = await getInspectionById(inspectionId, controller.signal);
        if (controller.signal.aborted) return;

        if (byId.ok) {
          const destinationUrl = byId.result.finalUrl || byId.result.submittedUrl;
          const destinationClean = formatCleanUrl(destinationUrl);
          writeUrSessionCache(destinationUrl, byId.result.id);
          loadedInspectionRef.current = {
            id: byId.result.id,
            cleanUrl: destinationClean,
            submitNonce,
          };
          setResult(byId.result);
          setQuickUrl(destinationUrl);
          setLoading(false);
          if (cleanSubmittedKey !== destinationClean || explicitQueryId) {
            previousCleanKeyRef.current = destinationClean;
            skipNextFetchRef.current = {
              id: byId.result.id,
              cleanUrl: destinationClean,
            };
            replaceCurrentTabParams(destinationUrl, byId.result.id);
          }
          return;
        }

        if (!submittedUrl) {
          loadedInspectionRef.current = null;
          setError(byId.error.message);
          setLoading(false);
          return;
        }
      }

      const targetInput = canonicalTargetInput || submittedUrl;
      if (targetInput) {
        const normalized = normalizeUrlInput(targetInput);
        if (!normalized.ok) {
          loadedInspectionRef.current = null;
          setError(normalized.message);
          setLoading(false);
          return;
        }

        const fresh = await runInspectForUrl(
          normalized.normalizedUrl,
          controller.signal,
        );
        if (controller.signal.aborted) return;

        if (fresh.ok) {
          const destinationUrl = fresh.result.finalUrl || fresh.result.submittedUrl;
          const destinationClean = formatCleanUrl(destinationUrl);
          writeUrSessionCache(destinationUrl, fresh.result.id);
          loadedInspectionRef.current = {
            id: fresh.result.id,
            cleanUrl: destinationClean,
            submitNonce,
          };
          setResult(fresh.result);
          setQuickUrl(destinationUrl);
          recordHistoryRef.current(fresh.result);
          setLoading(false);
          if (
            inspectionId !== fresh.result.id ||
            cleanSubmittedKey !== destinationClean ||
            explicitQueryId
          ) {
            previousCleanKeyRef.current = destinationClean;
            skipNextFetchRef.current = {
              id: fresh.result.id,
              cleanUrl: destinationClean,
            };
            replaceCurrentTabParams(destinationUrl, fresh.result.id);
          }
          return;
        }

        loadedInspectionRef.current = null;
        setError(fresh.error.message);
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [
    inspectionId,
    submittedUrl,
    cleanSubmittedKey,
    canonicalTargetInput,
    explicitQueryId,
    submitNonce,
    replaceCurrentTabParams,
  ]);

  const performReinspect = async (
    preserveOnError: boolean,
  ): Promise<InspectionResult | null> => {
    const rawTargetUrl = result?.finalUrl || canonicalTargetInput;
    if (!rawTargetUrl) return null;

    const normalized = normalizeUrlInput(rawTargetUrl);
    if (!normalized.ok) {
      if (!preserveOnError) {
        setResult(null);
        setError(normalized.message);
      }
      return null;
    }

    reinspectAbortRef.current?.abort();
    const controller = new AbortController();
    reinspectAbortRef.current = controller;
    if (!preserveOnError) setError(null);

    const outcome = await runInspectForUrl(
      normalized.normalizedUrl,
      controller.signal,
    );

    if (controller.signal.aborted) return null;
    if (reinspectAbortRef.current === controller) {
      reinspectAbortRef.current = null;
    }

    if (!outcome.ok) {
      if (!preserveOnError) {
        setResult(null);
        setError(outcome.error.message);
      }
      return null;
    }

    const destinationUrl = outcome.result.finalUrl || outcome.result.submittedUrl;
    const destinationClean = formatCleanUrl(destinationUrl);
    writeUrSessionCache(destinationUrl, outcome.result.id);
    loadedInspectionRef.current = {
      id: outcome.result.id,
      cleanUrl: destinationClean,
      submitNonce,
    };
    setResult(outcome.result);
    setQuickUrl(destinationUrl);
    recordHistoryRef.current(outcome.result);
    previousCleanKeyRef.current = destinationClean;
    skipNextFetchRef.current = { id: outcome.result.id, cleanUrl: destinationClean };
    replaceCurrentTabParams(destinationUrl, outcome.result.id);
    return outcome.result;
  };

  const handleReinspect = async () => {
    if (loading || isReinspecting || isPreparingAssets) return;
    setIsReinspecting(true);
    try {
      await performReinspect(false);
    } finally {
      setIsReinspecting(false);
    }
  };

  const handleOpenAssetManager = async () => {
    if (!result || loading || isReinspecting || isPreparingAssets) return;
    const runSeq = ++prepareSeqRef.current;
    setIsPreparingAssets(true);
    try {
      const targetId = result.id;
      const targetUrl =
        result.finalUrl || result.submittedUrl || canonicalTargetInput;
      await waitForNextPaint();
      if (prepareSeqRef.current !== runSeq) return;
      const [liveDomResources, serverCaptured] = await Promise.all([
        tabWebRef.current?.waitForAndCollectSources() ?? Promise.resolve([]),
        fetchCapturedAssets(targetId),
      ]);
      if (prepareSeqRef.current !== runSeq) return;
      setCapturedResources((prev) =>
        deduplicateResources([...serverCaptured, ...liveDomResources, ...prev]),
      );
      selectTab('aset', { id: targetId, url: targetUrl });
    } finally {
      if (prepareSeqRef.current === runSeq) {
        setIsPreparingAssets(false);
      }
    }
  };

  const handleDestinationRedirect = useCallback(
    (nextUrl: string) => {
      if (runtimeRedirectCountRef.current >= 2) return;
      const normalized = normalizeUrlInput(nextUrl);
      if (!normalized.ok) return;
      if (normalized.normalizedUrl === result?.finalUrl) return;
      runtimeRedirectCountRef.current += 1;
      navigate(
        buildResultsRoutePath('web', { url: normalized.normalizedUrl }),
        {
          replace: true,
          state: {
            canonicalUrl: normalized.normalizedUrl,
            fromWeb: true,
          } satisfies ResultsRouteState,
        },
      );
    },
    [navigate, result?.finalUrl],
  );

  const handleQuickSubmit = () => {
    const normalized = parseSingleSearchInput(quickUrl).outcome;
    if (!normalized.ok) {
      setQuickUrlError(normalized.message);
      return;
    }
    runtimeRedirectCountRef.current = 0;
    prepareSeqRef.current += 1;
    setIsPreparingAssets(false);
    reinspectAbortRef.current?.abort();
    reinspectAbortRef.current = null;
    setIsReinspecting(false);
    setQuickUrlError(null);
    const normalizedClean = formatCleanUrl(normalized.normalizedUrl);
    if (normalizedClean === cleanSubmittedKey && activeTab === 'web') {
      if (result) {
        void handleReinspect();
      } else {
        setSubmitNonce((prev) => prev + 1);
      }
      return;
    }
    navigate(buildResultsRoutePath('web', { url: normalized.normalizedUrl }), {
      state: {
        canonicalUrl: normalized.normalizedUrl,
        fromWeb: true,
      } satisfies ResultsRouteState,
    });
  };

  return {
    resolvedTab,
    activeTab,
    canReturnToWeb,
    selectTab,
    bulkId,
    submittedUrl,
    loading,
    isReinspecting,
    isPreparingAssets,
    error,
    result,
    liveResult,
    deduplicatedResources,
    hideWebChrome,
    setHideWebChrome,
    quickUrl,
    quickUrlError,
    setQuickUrlValue: (nextValue: string) => {
      setQuickUrl(nextValue);
      if (quickUrlError) setQuickUrlError(null);
    },
    tabWebRef,
    scheduleCaptureRefresh,
    collectAllLiveAssets,
    handleReinspect,
    handleOpenAssetManager,
    handleDestinationRedirect,
    handleQuickSubmit,
  };
}
