import { useEffect, useRef, type RefObject } from 'react';
import Hls from 'hls.js';
import type { VideoPlaybackFailureKind } from './media-player-utils';

interface UseHlsPlayerOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsUrl: string | null;
  enabled: boolean;
  startPosition?: number;
  autoStartLoad?: boolean;
  previewFirstFragment?: boolean;
  maxBufferLength?: number;
  onReady?: () => void;
  onError?: (kind: VideoPlaybackFailureKind) => void;
}

function isSupportedHlsUrl(url: string): boolean {
  return (
    url.startsWith('/api/hls/') ||
    url.startsWith('/smartcache/v1/hls/') ||
    url.startsWith('/api/asset')
  );
}

export function useHlsPlayer({
  videoRef,
  hlsUrl,
  enabled,
  startPosition = -1,
  autoStartLoad = true,
  previewFirstFragment = false,
  maxBufferLength = 30,
  onReady,
  onError,
}: UseHlsPlayerOptions): void {
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const autoStartRef = useRef(autoStartLoad);
  const startPosRef = useRef(startPosition);

  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  autoStartRef.current = autoStartLoad;
  startPosRef.current = startPosition;

  useEffect(() => {
    const hls = hlsInstanceRef.current;
    if (!hls) return;
    if (autoStartLoad) {
      hls.startLoad(startPosRef.current > 0 ? startPosRef.current : -1);
    } else if (previewFirstFragment) {
      hls.startLoad(startPosRef.current > 0 ? startPosRef.current : -1);
    }
  }, [autoStartLoad, previewFirstFragment]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !hlsUrl || !video || !isSupportedHlsUrl(hlsUrl)) {
      return;
    }

    let cancelled = false;
    let recoveredOnce = false;
    let hls: Hls | null = null;
    const initialStartPosition = startPosRef.current > 0 ? startPosRef.current : -1;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        autoStartLoad: autoStartRef.current || previewFirstFragment,
        startPosition: initialStartPosition,
        maxBufferLength,
      });
      hlsInstanceRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) onReadyRef.current?.();
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (!cancelled && !autoStartRef.current && hls) {
          // Stop downloading extra segments on mini-cards after first preview fragment
          hls.stopLoad();
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal || !hls) return;
        if (!recoveredOnce && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          recoveredOnce = true;
          hls.recoverMediaError();
          return;
        }
        if (!recoveredOnce && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          recoveredOnce = true;
          hls.startLoad();
          return;
        }
        hls.destroy();
        hls = null;
        hlsInstanceRef.current = null;
        onErrorRef.current?.(
          data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'decode' : 'network',
        );
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
    } else {
      onErrorRef.current?.('src');
    }

    return () => {
      cancelled = true;
      hlsInstanceRef.current = null;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (video) {
        const currentSrcAttr = video.getAttribute('src') ?? '';
        if (isSupportedHlsUrl(currentSrcAttr)) {
          video.removeAttribute('src');
          video.load();
        }
      }
    };
  }, [enabled, hlsUrl, maxBufferLength, previewFirstFragment, videoRef]);
}
