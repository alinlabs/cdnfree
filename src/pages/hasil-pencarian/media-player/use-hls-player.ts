import { useEffect, useRef, type RefObject } from 'react';
import Hls from 'hls.js';
import type { VideoPlaybackFailureKind } from './media-player-utils';

interface UseHlsPlayerOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsUrl: string | null;
  enabled: boolean;
  onReady?: () => void;
  onError?: (kind: VideoPlaybackFailureKind) => void;
}

export function useHlsPlayer({
  videoRef,
  hlsUrl,
  enabled,
  onReady,
  onError,
}: UseHlsPlayerOptions): void {
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !hlsUrl || !video || !hlsUrl.startsWith('/api/hls/')) {
      return;
    }

    let cancelled = false;
    let recoveredOnce = false;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) onReadyRef.current?.();
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
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (video && video.getAttribute('src')?.startsWith('/api/hls/')) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [enabled, hlsUrl, videoRef]);
}
