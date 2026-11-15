import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngineServiceWorker } from '../../../hooks/use-engine-sw';
import { loadSettings } from '../../../services/settings-service';
import type { ResourceRecord } from '../../../types/inspection';
import {
  classifyResourceKind,
  inferMimeHintFromUrl,
} from '../../../utils/classify-resource';
import { getHostnameSafe } from '../../../utils/inspection-details';
import {
  clearEngineHostFailures,
  ENGINE_FAILURE_THRESHOLD,
  recordEngineHostFailure,
  type WebRenderMode,
} from '../../../utils/web-view-policy';

const DEFAULT_FRAME_HEIGHT = 640;
const MAX_FRAME_HEIGHT = 24_000;
const SLOW_FRAME_THRESHOLD_MS = 9_000;

function stripUrlHash(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

interface UseWebFrameOptions {
  finalUrl: string;
  initialMode: WebRenderMode;
  isHtmlProxy: boolean;
  onAssetObserved?: () => void;
  onDestinationRedirect?: (nextUrl: string) => void;
}

export type WebFrameStatus = 'loading' | 'ready' | 'empty';

export function useWebFrame({
  finalUrl,
  initialMode,
  isHtmlProxy,
  onAssetObserved,
  onDestinationRedirect,
}: UseWebFrameOptions) {
  const [renderMode, setRenderModeState] = useState<WebRenderMode>(initialMode);
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_HEIGHT);
  const [activeTargetUrl, setActiveTargetUrl] = useState(finalUrl);
  const [bypassExternalLinks, setBypassExternalLinks] = useState(
    () => loadSettings().data.protection.bypassExternalLinks,
  );
  const [bypassNotice, setBypassNotice] = useState<string | null>(null);
  const [frameStatus, setFrameStatus] = useState<WebFrameStatus>('loading');
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [engineFallbackNotice, setEngineFallbackNotice] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bypassNoticeTimerRef = useRef<number | null>(null);
  const slowTimerRef = useRef<number | null>(null);
  const engineSafetyTimerRef = useRef<number | null>(null);
  const emptyCheckTimerRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const measureTimerRef = useRef<number | null>(null);
  const rafMeasureRef = useRef<number | null>(null);
  const resizeUpdatesRef = useRef(0);
  const observedEngineAssetsRef = useRef<Map<string, ResourceRecord>>(new Map());

  const onAssetObservedRef = useRef(onAssetObserved);
  onAssetObservedRef.current = onAssetObserved;
  const onDestinationRedirectRef = useRef(onDestinationRedirect);
  onDestinationRedirectRef.current = onDestinationRedirect;
  const finalUrlRef = useRef(finalUrl);
  finalUrlRef.current = finalUrl;
  const renderModeRef = useRef(renderMode);
  renderModeRef.current = renderMode;

  const engineSw = useEngineServiceWorker(isHtmlProxy && renderMode === 'engine');

  const clearPendingMeasure = useCallback(() => {
    if (measureTimerRef.current !== null) {
      window.clearTimeout(measureTimerRef.current);
      measureTimerRef.current = null;
    }
    if (rafMeasureRef.current !== null) {
      window.cancelAnimationFrame(rafMeasureRef.current);
      rafMeasureRef.current = null;
    }
  }, []);

  const clearSlowTimer = useCallback(() => {
    if (slowTimerRef.current !== null) {
      window.clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
  }, []);

  const clearEngineSafetyTimer = useCallback(() => {
    if (engineSafetyTimerRef.current !== null) {
      window.clearTimeout(engineSafetyTimerRef.current);
      engineSafetyTimerRef.current = null;
    }
  }, []);

  const clearEmptyCheckTimer = useCallback(() => {
    if (emptyCheckTimerRef.current !== null) {
      window.clearTimeout(emptyCheckTimerRef.current);
      emptyCheckTimerRef.current = null;
    }
  }, []);

  const measureFrameHeight = useCallback(() => {
    if (renderModeRef.current === 'engine') return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;

      const body = doc.body;
      const html = doc.documentElement;
      const measured = Math.max(
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
        html?.scrollHeight ?? 0,
        html?.offsetHeight ?? 0,
        DEFAULT_FRAME_HEIGHT,
      );
      const clamped = Math.min(measured, MAX_FRAME_HEIGHT);

      setFrameHeight((prev) => {
        if (Math.abs(prev - clamped) <= 4) return prev;
        if (clamped > prev && resizeUpdatesRef.current >= 24) return prev;
        resizeUpdatesRef.current += 1;
        return clamped;
      });
    } catch {
      // Ignore cross-origin frame access
    }
  }, []);

  const scheduleMeasureFrameHeight = useCallback(
    (delayMs = 40) => {
      if (renderModeRef.current === 'engine') return;
      clearPendingMeasure();
      measureTimerRef.current = window.setTimeout(() => {
        measureTimerRef.current = null;
        rafMeasureRef.current = window.requestAnimationFrame(() => {
          rafMeasureRef.current = null;
          measureFrameHeight();
        });
      }, delayMs);
    },
    [clearPendingMeasure, measureFrameHeight],
  );

  const attachFrameObservers = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    clearPendingMeasure();

    if (renderModeRef.current === 'engine') return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;

      scheduleMeasureFrameHeight(0);

      if (!doc.body || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        scheduleMeasureFrameHeight(60);
      });
      observer.observe(doc.body);
      resizeObserverRef.current = observer;
    } catch {
      // Ignore cross-origin errors
    }
  }, [clearPendingMeasure, scheduleMeasureFrameHeight]);

  const checkFrameEmptyState = useCallback(() => {
    if (renderModeRef.current === 'engine') return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      const hasMediaOrStructure = Boolean(
        doc.body.querySelector(
          'img,video,svg,canvas,iframe,main,article,section,header,form,table,ul,p,h1,h2,h3',
        ),
      );
      const textLen = (doc.body.textContent || '').trim().length;
      if (!hasMediaOrStructure && textLen === 0 && doc.body.scrollHeight === 0) {
        setFrameStatus('empty');
      } else {
        setFrameStatus('ready');
      }
    } catch {
      setFrameStatus('ready');
    }
  }, []);

  const switchRenderMode = useCallback(
    (nextMode: WebRenderMode) => {
      if (nextMode === renderModeRef.current) return;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      clearPendingMeasure();
      clearEngineSafetyTimer();
      clearEmptyCheckTimer();
      setEngineError(null);
      setEngineFallbackNotice(null);
      setFrameStatus('loading');
      setIsSlowLoading(false);
      resizeUpdatesRef.current = 0;

      if (nextMode === 'engine') {
        clearEngineHostFailures(getHostnameSafe(finalUrlRef.current));
      }
      setRenderModeState(nextMode);
      setReloadNonce((n) => n + 1);
    },
    [clearEmptyCheckTimer, clearEngineSafetyTimer, clearPendingMeasure],
  );

  const handleFrameLoad = useCallback(() => {
    if (renderModeRef.current === 'engine') {
      clearEmptyCheckTimer();
      clearEngineSafetyTimer();
      engineSafetyTimerRef.current = window.setTimeout(() => {
        engineSafetyTimerRef.current = null;
        clearSlowTimer();
        setIsSlowLoading(false);
        setFrameStatus((prev) => (prev === 'loading' ? 'ready' : prev));
      }, 2_500);
      return;
    }

    clearSlowTimer();
    clearEmptyCheckTimer();
    setIsSlowLoading(false);
    setFrameStatus('ready');
    onAssetObservedRef.current?.();
    attachFrameObservers();
    scheduleMeasureFrameHeight(250);
    emptyCheckTimerRef.current = window.setTimeout(() => {
      emptyCheckTimerRef.current = null;
      checkFrameEmptyState();
    }, 350);
  }, [
    attachFrameObservers,
    checkFrameEmptyState,
    clearEmptyCheckTimer,
    clearEngineSafetyTimer,
    clearSlowTimer,
    scheduleMeasureFrameHeight,
  ]);

  const reloadFrame = useCallback(() => {
    clearEmptyCheckTimer();
    setEngineError(null);
    setFrameStatus('loading');
    setIsSlowLoading(false);
    setFrameHeight(DEFAULT_FRAME_HEIGHT);
    resizeUpdatesRef.current = 0;

    if (renderModeRef.current === 'engine' && engineSw.status === 'error') {
      void engineSw.ensureReady();
    }
    setReloadNonce((n) => n + 1);
  }, [clearEmptyCheckTimer, engineSw]);

  const getObservedEngineResources = useCallback(
    () => Array.from(observedEngineAssetsRef.current.values()),
    [],
  );

  useEffect(() => {
    setRenderModeState(initialMode);
    setActiveTargetUrl(finalUrl);
    setFrameHeight(DEFAULT_FRAME_HEIGHT);
    setFrameStatus('loading');
    setIsSlowLoading(false);
    setEngineError(null);
    setEngineFallbackNotice(null);
    observedEngineAssetsRef.current.clear();
    resizeUpdatesRef.current = 0;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    clearPendingMeasure();
    clearEngineSafetyTimer();
    clearEmptyCheckTimer();
  }, [
    finalUrl,
    initialMode,
    clearEmptyCheckTimer,
    clearEngineSafetyTimer,
    clearPendingMeasure,
  ]);

  useEffect(() => {
    clearSlowTimer();
    if (frameStatus !== 'loading') return;
    slowTimerRef.current = window.setTimeout(() => {
      slowTimerRef.current = null;
      setIsSlowLoading(true);
    }, SLOW_FRAME_THRESHOLD_MS);
    return clearSlowTimer;
  }, [frameStatus, reloadNonce, finalUrl, renderMode, clearSlowTimer]);

  useEffect(() => {
    const syncBypassSetting = () => {
      setBypassExternalLinks(loadSettings().data.protection.bypassExternalLinks);
    };
    syncBypassSetting();
    window.addEventListener('focus', syncBypassSetting);
    window.addEventListener('storage', syncBypassSetting);
    return () => {
      window.removeEventListener('focus', syncBypassSetting);
      window.removeEventListener('storage', syncBypassSetting);
      resizeObserverRef.current?.disconnect();
      clearPendingMeasure();
      clearSlowTimer();
      clearEngineSafetyTimer();
      clearEmptyCheckTimer();
      if (bypassNoticeTimerRef.current !== null) {
        window.clearTimeout(bypassNoticeTimerRef.current);
      }
    };
  }, [
    clearEmptyCheckTimer,
    clearEngineSafetyTimer,
    clearPendingMeasure,
    clearSlowTimer,
  ]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        iframeRef.current?.contentWindow &&
        event.source !== iframeRef.current.contentWindow
      ) {
        return;
      }

      const data = event.data as {
        type?: unknown;
        url?: unknown;
        destination?: unknown;
        message?: unknown;
      } | null;
      if (!data || typeof data !== 'object') return;

      if (renderModeRef.current === 'engine') {
        if (data.type === 'cdnfree:ready' || data.type === 'cdnfree:url') {
          clearEngineSafetyTimer();
          clearSlowTimer();
          setIsSlowLoading(false);
          setEngineError(null);
          setFrameStatus('ready');
          if (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) {
            setActiveTargetUrl(data.url);
          }
          onAssetObservedRef.current?.();
          return;
        }
        if (
          data.type === 'cdnfree:asset' &&
          typeof data.url === 'string' &&
          /^https?:\/\//i.test(data.url)
        ) {
          const map = observedEngineAssetsRef.current;
          if (!map.has(data.url) && map.size < 800) {
            const host = getHostnameSafe(data.url);
            if (host) {
              const asHint =
                typeof data.destination === 'string' ? data.destination : undefined;
              const mimeType = inferMimeHintFromUrl(data.url);
              const kind = classifyResourceKind(data.url, {
                source: 'browser-observed',
                asHint,
                mimeHint: mimeType,
              });
              map.set(data.url, {
                id: `engine-${map.size}-${host}`,
                url: data.url,
                host,
                kind,
                mimeType,
                classification: 'unknown',
                source: 'browser-observed',
                observation: 'fetched',
              });
            }
          }
          onAssetObservedRef.current?.();
          return;
        }
        if (data.type === 'cdnfree:engine-error') {
          clearEngineSafetyTimer();
          clearSlowTimer();
          setIsSlowLoading(false);
          const host = getHostnameSafe(finalUrlRef.current);
          const count = recordEngineHostFailure(host);
          const msg =
            typeof data.message === 'string' && data.message.trim()
              ? data.message
              : 'Mode Engine gagal memuat halaman target.';
          if (count >= ENGINE_FAILURE_THRESHOLD) {
            resizeObserverRef.current?.disconnect();
            resizeObserverRef.current = null;
            setEngineError(null);
            setEngineFallbackNotice(
              `Mode Engine gagal ${count}× pada host ini; otomatis beralih ke Mode Ringan.`,
            );
            setFrameStatus('loading');
            setRenderModeState('light');
            setReloadNonce((n) => n + 1);
          } else {
            setEngineError(msg);
            setFrameStatus('ready');
          }
          return;
        }
        return;
      }

      if (
        (data.type === 'cdnfree:redirect' || data.type === 'cdnfree:ready') &&
        typeof data.url === 'string' &&
        /^https?:\/\//i.test(data.url)
      ) {
        const currentHost = getHostnameSafe(finalUrlRef.current);
        const nextHost = getHostnameSafe(data.url);
        const crossHost = Boolean(
          bypassExternalLinks &&
            currentHost &&
            nextHost &&
            currentHost !== nextHost &&
            !nextHost.endsWith(`.${currentHost}`) &&
            !currentHost.endsWith(`.${nextHost}`),
        );
        if (data.type === 'cdnfree:redirect' && crossHost) {
          setBypassNotice(nextHost);
          return;
        }
        clearSlowTimer();
        setIsSlowLoading(false);
        setFrameStatus('ready');
        setActiveTargetUrl(data.url);
        onAssetObservedRef.current?.();
        attachFrameObservers();
        if (stripUrlHash(data.url) !== stripUrlHash(finalUrlRef.current)) {
          onDestinationRedirectRef.current?.(data.url);
        }
      } else if (
        data.type === 'cdnfree:navigate' &&
        typeof data.url === 'string' &&
        /^https?:\/\//i.test(data.url)
      ) {
        setFrameStatus('loading');
        setActiveTargetUrl(data.url);
        onAssetObservedRef.current?.();
        attachFrameObservers();
      } else if (
        data.type === 'cdnfree:external-bypassed' &&
        typeof data.url === 'string'
      ) {
        const host = getHostnameSafe(data.url) || data.url;
        setBypassNotice(host);
        if (bypassNoticeTimerRef.current !== null) {
          window.clearTimeout(bypassNoticeTimerRef.current);
        }
        bypassNoticeTimerRef.current = window.setTimeout(() => {
          bypassNoticeTimerRef.current = null;
          setBypassNotice(null);
        }, 3500);
      } else if (data.type === 'cdnfree:asset') {
        onAssetObservedRef.current?.();
        scheduleMeasureFrameHeight(60);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    attachFrameObservers,
    bypassExternalLinks,
    clearEngineSafetyTimer,
    clearSlowTimer,
    scheduleMeasureFrameHeight,
  ]);

  return {
    iframeRef,
    renderMode,
    switchRenderMode,
    swStatus: engineSw.status,
    swErrorMessage: engineSw.errorMessage,
    frameHeight,
    frameStatus,
    isSlowLoading,
    engineError,
    engineFallbackNotice,
    dismissEngineFallbackNotice: () => setEngineFallbackNotice(null),
    reloadNonce,
    activeTargetUrl,
    bypassExternalLinks,
    bypassNotice,
    dismissBypassNotice: () => setBypassNotice(null),
    handleFrameLoad,
    reloadFrame,
    getObservedEngineResources,
  };
}
