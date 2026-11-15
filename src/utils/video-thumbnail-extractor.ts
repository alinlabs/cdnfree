export type FrameCaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'not-ready' | 'tainted' | 'empty' };

export function drawVideoFrameToDataUrl(
  video: Pick<HTMLVideoElement, 'readyState' | 'videoWidth' | 'videoHeight'>,
  maxWidth = 480,
  quality = 0.72,
): FrameCaptureResult {
  if (
    typeof document === 'undefined' ||
    video.readyState < 2 ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return { ok: false, reason: 'not-ready' };
  }

  const targetWidth = Math.min(maxWidth, video.videoWidth);
  const targetHeight = Math.max(
    1,
    Math.round((video.videoHeight / video.videoWidth) * targetWidth),
  );

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'empty' };

  try {
    ctx.drawImage(video as HTMLVideoElement, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length <= 100) {
      return { ok: false, reason: 'empty' };
    }
    return { ok: true, dataUrl };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : '';
    if (
      name === 'SecurityError' ||
      /taint|cross-origin|security/i.test(message)
    ) {
      return { ok: false, reason: 'tainted' };
    }
    return { ok: false, reason: 'empty' };
  }
}

const MAX_CONCURRENT_EXTRACTIONS = 2;
const EXTRACTION_TIMEOUT_MS = 10_000;

let activeCount = 0;
const waitQueue: Array<() => void> = [];
const inFlightByKey = new Map<string, Promise<string | null>>();

function acquireSlot(signal?: AbortSignal): Promise<(() => void) | null> {
  if (signal?.aborted) return Promise.resolve(null);
  if (activeCount < MAX_CONCURRENT_EXTRACTIONS) {
    activeCount += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      activeCount = Math.max(0, activeCount - 1);
      const next = waitQueue.shift();
      if (next) next();
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const idx = waitQueue.indexOf(start);
      if (idx !== -1) waitQueue.splice(idx, 1);
      resolve(null);
    };
    const start = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      activeCount += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeCount = Math.max(0, activeCount - 1);
        const next = waitQueue.shift();
        if (next) next();
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    waitQueue.push(start);
  });
}

function extractFrameFromProxyVideo(
  proxyUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (typeof document === 'undefined' || !proxyUrl || signal?.aborted) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let finished = false;
    let seekPending = false;
    let timeoutId: number | null = null;

    const cleanup = (result: string | null) => {
      if (finished) return;
      finished = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener('abort', handleAbort);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Ignore cleanup failures
      }
      resolve(result);
    };

    const tryCapture = () => {
      const captured = drawVideoFrameToDataUrl(video);
      if (captured.ok) {
        cleanup(captured.dataUrl);
        return true;
      }
      return false;
    };

    const handleAbort = () => cleanup(null);
    const handleError = () => cleanup(null);

    const handleLoadedMetadata = () => {
      if (finished) return;
      const dur =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (dur > 0.25 && video.currentTime < 0.05) {
        seekPending = true;
        try {
          video.currentTime = Math.min(0.35, dur * 0.1);
        } catch {
          seekPending = false;
        }
      }
    };

    const handleLoadedData = () => {
      if (finished) return;
      if (!seekPending) {
        tryCapture();
      }
    };

    const handleSeeked = () => {
      if (finished) return;
      seekPending = false;
      if (!tryCapture()) {
        cleanup(null);
      }
    };

    timeoutId = window.setTimeout(() => {
      if (!tryCapture()) {
        cleanup(null);
      }
    }, EXTRACTION_TIMEOUT_MS);

    signal?.addEventListener('abort', handleAbort, { once: true });
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    video.src = proxyUrl;
    try {
      video.load();
    } catch {
      cleanup(null);
    }
  });
}

export function captureThumbnailFromUrl(
  cacheKey: string,
  sameOriginProxyUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!cacheKey || !sameOriginProxyUrl || signal?.aborted) {
    return Promise.resolve(null);
  }
  const existing = inFlightByKey.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    const release = await acquireSlot(signal);
    if (!release) return null;
    try {
      return await extractFrameFromProxyVideo(sameOriginProxyUrl, signal);
    } finally {
      release();
    }
  })().finally(() => {
    inFlightByKey.delete(cacheKey);
  });

  inFlightByKey.set(cacheKey, task);
  return task;
}
