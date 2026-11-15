export interface CollectFrameOptions {
  triggerLazyScroll?: boolean;
  muteMedia?: boolean;
  mode?: 'engine' | 'light';
}

function decodeProxyUrlParam(encoded: string): string | null {
  try {
    let normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) {
      normalized += '=';
    }
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function resolveSourceUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^(#|javascript:|mailto:|tel:|data:|blob:|about:)/i.test(trimmed)) {
    return null;
  }

  try {
    const parsedProxy = new URL(trimmed, window.location.origin);
    if (
      parsedProxy.origin === window.location.origin &&
      (parsedProxy.pathname === '/api/asset' || parsedProxy.pathname === '/api/proxy')
    ) {
      const encoded = parsedProxy.searchParams.get('u');
      if (encoded) {
        const decoded = decodeProxyUrlParam(encoded);
        if (decoded && /^https?:\/\//i.test(decoded)) {
          return decoded;
        }
      }
      return null;
    }
  } catch {
    // Fall through to standard resolution
  }

  try {
    const abs = new URL(trimmed, baseUrl).href;
    return /^https?:\/\//i.test(abs) ? abs : null;
  } catch {
    return null;
  }
}

export function extractCssUrls(cssValue: string): string[] {
  const results: string[] = [];
  const regex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cssValue)) !== null) {
    if (match[2]) {
      results.push(match[2]);
    }
  }
  return results;
}

export function extractSrcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function isProxyDocLoaded(doc: Document | null | undefined): boolean {
  if (!doc || doc.readyState !== 'complete') return false;
  try {
    return Boolean(doc.URL && doc.URL !== 'about:blank');
  } catch {
    return true;
  }
}

export function waitForIframeReady(
  iframe: HTMLIFrameElement,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (isProxyDocLoaded(iframe.contentDocument)) {
        resolve();
        return;
      }
    } catch {
      resolve();
      return;
    }

    let settled = false;
    let pollTimer: number | null = null;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      iframe.removeEventListener('load', onLoad);
      window.clearTimeout(timer);
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      resolve();
    };

    const onLoad = () => {
      try {
        if (iframe.contentDocument?.URL === 'about:blank') {
          return;
        }
      } catch {
        // Cross-origin frame finished loading
      }
      cleanup();
    };

    pollTimer = window.setInterval(() => {
      try {
        if (isProxyDocLoaded(iframe.contentDocument)) {
          cleanup();
        }
      } catch {
        cleanup();
      }
    }, 100);

    const timer = window.setTimeout(cleanup, timeoutMs);
    iframe.addEventListener('load', onLoad);
  });
}

export function waitForPendingImages(
  doc: Document,
  timeoutMs: number,
): Promise<void> {
  const images = Array.from(doc.images);
  for (const img of images) {
    if (img.loading === 'lazy') {
      img.loading = 'eager';
    }
  }

  const pending = images.filter((img) => Boolean(img.src) && !img.complete);
  if (pending.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let remaining = pending.length;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      for (const img of pending) {
        img.removeEventListener('load', onOneDone);
        img.removeEventListener('error', onOneDone);
      }
      resolve();
    };

    const onOneDone = () => {
      remaining -= 1;
      if (remaining <= 0) {
        cleanup();
      }
    };

    const timer = window.setTimeout(cleanup, timeoutMs);
    for (const img of pending) {
      img.addEventListener('load', onOneDone);
      img.addEventListener('error', onOneDone);
    }
  });
}

export function waitForDomSettle(
  doc: Document,
  maxWaitMs: number,
  idleMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const root = doc.body ?? doc.documentElement;
    if (!root || typeof MutationObserver === 'undefined') {
      resolve();
      return;
    }

    let settled = false;
    let idleTimer: number | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(maxTimer);
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
      }
      resolve();
    };

    const resetIdle = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(cleanup, idleMs);
    };

    const observer = new MutationObserver(() => {
      resetIdle();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'data-src', 'poster', 'style'],
    });

    const maxTimer = window.setTimeout(cleanup, maxWaitMs);
    resetIdle();
  });
}

export async function nudgeLazyElements(
  doc: Document,
  win: Window | null,
  options?: CollectFrameOptions,
): Promise<void> {
  doc.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach((el) => {
    el.setAttribute('loading', 'eager');
  });

  if (options?.muteMedia) {
    doc.querySelectorAll('video, audio').forEach((el) => {
      if (el instanceof HTMLMediaElement) {
        el.muted = true;
        try {
          el.pause();
        } catch {
          // Ignore media control errors
        }
      }
    });
  }

  if (!options?.triggerLazyScroll || !win) return;

  const prevX = win.scrollX;
  const prevY = win.scrollY;
  try {
    const docHeight = Math.max(
      doc.body?.scrollHeight ?? 0,
      doc.documentElement?.scrollHeight ?? 0,
    );
    const viewportHeight = win.innerHeight || 900;
    if (docHeight > viewportHeight) {
      const steps = [
        Math.round(docHeight * 0.35),
        Math.round(docHeight * 0.72),
        Math.max(0, docHeight - viewportHeight),
      ];
      for (const y of steps) {
        win.scrollTo(prevX, y);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 140));
      }
      await waitForDomSettle(doc, 900, 260);
    }
  } catch {
    // Ignore scroll errors
  } finally {
    try {
      win.scrollTo(prevX, prevY);
    } catch {
      // Ignore restore errors
    }
  }
}
