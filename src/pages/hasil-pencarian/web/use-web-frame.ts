import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings } from '../../../services/settings-service';
import { getHostnameSafe } from '../../../utils/inspection-details';

const DEFAULT_FRAME_HEIGHT = 560;
const MAX_FRAME_HEIGHT = 24_000;

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
  onAssetObserved?: () => void;
  onDestinationRedirect?: (nextUrl: string) => void;
}

export function useWebFrame({
  finalUrl,
  onAssetObserved,
  onDestinationRedirect,
}: UseWebFrameOptions) {
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_HEIGHT);
  const [activeTargetUrl, setActiveTargetUrl] = useState(finalUrl);
  const [bypassExternalLinks, setBypassExternalLinks] = useState(
    () => loadSettings().data.protection.bypassExternalLinks,
  );
  const [bypassNotice, setBypassNotice] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bypassNoticeTimerRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const measureTimerRef = useRef<number | null>(null);
  const resizeUpdatesRef = useRef(0);

  const onAssetObservedRef = useRef(onAssetObserved);
  onAssetObservedRef.current = onAssetObserved;
  const onDestinationRedirectRef = useRef(onDestinationRedirect);
  onDestinationRedirectRef.current = onDestinationRedirect;
  const finalUrlRef = useRef(finalUrl);
  finalUrlRef.current = finalUrl;

  const clearPendingMeasure = useCallback(() => {
    if (measureTimerRef.current !== null) {
      window.clearTimeout(measureTimerRef.current);
      measureTimerRef.current = null;
    }
  }, []);

  const measureFrameHeight = useCallback(() => {
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
        if (clamped > prev && resizeUpdatesRef.current >= 20) return prev;
        resizeUpdatesRef.current += 1;
        return clamped;
      });
    } catch {
      // Ignore cross-origin frame access if proxy redirects externally
    }
  }, []);

  const scheduleMeasureFrameHeight = useCallback(
    (delayMs = 40) => {
      clearPendingMeasure();
      measureTimerRef.current = window.setTimeout(() => {
        measureTimerRef.current = null;
        measureFrameHeight();
      }, delayMs);
    },
    [clearPendingMeasure, measureFrameHeight],
  );

  const attachFrameObservers = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    clearPendingMeasure();

    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;

      if (doc.documentElement && doc.documentElement.style.overflowY !== 'hidden') {
        doc.documentElement.style.overflowY = 'hidden';
      }
      if (doc.body && doc.body.style.overflowY !== 'visible') {
        doc.body.style.overflowY = 'visible';
      }

      scheduleMeasureFrameHeight(0);

      if (!doc.body || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        scheduleMeasureFrameHeight(50);
      });
      observer.observe(doc.body);
      resizeObserverRef.current = observer;
    } catch {
      // Ignore cross-origin errors
    }
  }, [clearPendingMeasure, scheduleMeasureFrameHeight]);

  const handleFrameLoad = useCallback(() => {
    onAssetObservedRef.current?.();
    attachFrameObservers();
    scheduleMeasureFrameHeight(250);
  }, [attachFrameObservers, scheduleMeasureFrameHeight]);

  useEffect(() => {
    setActiveTargetUrl(finalUrl);
    setFrameHeight(DEFAULT_FRAME_HEIGHT);
    resizeUpdatesRef.current = 0;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    clearPendingMeasure();
  }, [finalUrl, clearPendingMeasure]);

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
      if (bypassNoticeTimerRef.current !== null) {
        window.clearTimeout(bypassNoticeTimerRef.current);
      }
    };
  }, [clearPendingMeasure]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        iframeRef.current?.contentWindow &&
        event.source !== iframeRef.current.contentWindow
      ) {
        return;
      }

      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || typeof data !== 'object') return;

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
        setActiveTargetUrl(data.url);
        onAssetObservedRef.current?.();
        attachFrameObservers();
      } else if (data.type === 'cdnfree:external-bypassed' && typeof data.url === 'string') {
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
  }, [attachFrameObservers, bypassExternalLinks, scheduleMeasureFrameHeight]);

  return {
    iframeRef,
    frameHeight,
    activeTargetUrl,
    bypassExternalLinks,
    bypassNotice,
    dismissBypassNotice: () => setBypassNotice(null),
    handleFrameLoad,
  };
}
