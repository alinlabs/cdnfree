import type { ResourceRecord } from '../../../types/inspection';
import {
  classifyResourceKind,
  inferMimeHintFromUrl,
} from '../../../utils/classify-resource';
import { getHostnameSafe } from '../../../utils/inspection-details';

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

function resolveSourceUrl(raw: string, baseUrl: string): string | null {
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

function extractCssUrls(cssValue: string): string[] {
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

function extractSrcsetUrls(srcset: string): string[] {
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

function waitForIframeReady(
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

function waitForPendingImages(
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

export async function waitAndCollectFrameResources(
  iframe: HTMLIFrameElement | null,
  pageUrl: string,
): Promise<ResourceRecord[]> {
  if (!iframe) return [];

  await waitForIframeReady(iframe, 6000);

  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }

  if (!doc) return [];

  await waitForPendingImages(doc, 2500);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 200));

  const collectedMap = new Map<string, ResourceRecord>();

  const registerUrl = (
    raw: string | null | undefined,
    hint?: {
      source?: ResourceRecord['source'];
      rel?: string;
      asHint?: string;
      mimeHint?: string;
      posterUrl?: string;
    },
  ) => {
    if (!raw) return;
    const resolved = resolveSourceUrl(raw, pageUrl);
    if (!resolved) return;

    const existing = collectedMap.get(resolved);
    if (existing) {
      if (!existing.posterUrl && hint?.posterUrl) {
        existing.posterUrl = hint.posterUrl;
      }
      return;
    }

    const host = getHostnameSafe(resolved);
    if (!host) return;

    const mimeType = hint?.mimeHint || inferMimeHintFromUrl(resolved);
    const kind = classifyResourceKind(resolved, {
      source: hint?.source ?? 'browser-observed',
      rel: hint?.rel,
      asHint: hint?.asHint,
      mimeHint: mimeType,
    });

    collectedMap.set(resolved, {
      id: `dom-${collectedMap.size}-${host}`,
      url: resolved,
      host,
      kind,
      mimeType,
      posterUrl: kind === 'video' ? hint?.posterUrl : undefined,
      classification: 'unknown',
      source: hint?.source ?? 'browser-observed',
      observation: 'fetched',
    });
  };

  doc.querySelectorAll('img').forEach((el) => {
    registerUrl(el.currentSrc || el.getAttribute('src'), { source: 'html-img' });
    registerUrl(el.getAttribute('data-src'), { source: 'html-img' });
    const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset');
    if (srcset) {
      extractSrcsetUrls(srcset).forEach((u) => registerUrl(u, { source: 'html-img' }));
    }
  });

  doc.querySelectorAll('video').forEach((el) => {
    const rawPoster = el.getAttribute('poster');
    const resolvedPoster = rawPoster ? resolveSourceUrl(rawPoster, pageUrl) ?? undefined : undefined;
    registerUrl(el.currentSrc || el.getAttribute('src'), {
      source: 'html-video',
      posterUrl: resolvedPoster,
    });
    registerUrl(el.getAttribute('data-src'), {
      source: 'html-video',
      posterUrl: resolvedPoster,
    });
    registerUrl(rawPoster, { source: 'html-img', asHint: 'image' });
  });

  doc.querySelectorAll('audio').forEach((el) => {
    registerUrl(el.currentSrc || el.getAttribute('src'), { source: 'html-audio' });
    registerUrl(el.getAttribute('data-src'), { source: 'html-audio' });
  });

  doc.querySelectorAll('source').forEach((el) => {
    const parentTag = el.parentElement?.tagName.toLowerCase();
    const asHint = parentTag === 'picture' ? 'image' : parentTag;
    const rawParentPoster =
      parentTag === 'video' ? el.parentElement?.getAttribute('poster') : null;
    const resolvedPoster = rawParentPoster
      ? resolveSourceUrl(rawParentPoster, pageUrl) ?? undefined
      : undefined;
    registerUrl(el.getAttribute('src'), {
      source: 'html-source',
      asHint,
      posterUrl: resolvedPoster,
    });
    registerUrl(el.getAttribute('data-src'), {
      source: 'html-source',
      asHint,
      posterUrl: resolvedPoster,
    });
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      extractSrcsetUrls(srcset).forEach((u) =>
        registerUrl(u, { source: 'html-source', asHint }),
      );
    }
  });

  doc.querySelectorAll('link[href]').forEach((el) => {
    const rel = el.getAttribute('rel') ?? '';
    const asHint = el.getAttribute('as') ?? undefined;
    if (/^(dns-prefetch|preconnect|canonical|alternate)$/i.test(rel.trim())) {
      return;
    }
    registerUrl(el.getAttribute('href'), {
      source: 'html-link',
      rel,
      asHint,
    });
  });

  doc.querySelectorAll('script[src]').forEach((el) => {
    registerUrl(el.getAttribute('src'), { source: 'html-script', asHint: 'script' });
  });

  doc.querySelectorAll('image, use').forEach((el) => {
    registerUrl(el.getAttribute('href') || el.getAttribute('xlink:href'), {
      source: 'html-img',
      asHint: 'image',
    });
  });

  doc.querySelectorAll('[style]').forEach((el) => {
    const styleText = el.getAttribute('style');
    if (styleText && styleText.includes('url(')) {
      extractCssUrls(styleText).forEach((u) =>
        registerUrl(u, { source: 'css-reference' }),
      );
    }
  });

  try {
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRuleList | undefined;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        const cssText = rule.cssText;
        if (cssText && cssText.includes('url(')) {
          const isFontRule = rule.type === CSSRule.FONT_FACE_RULE;
          extractCssUrls(cssText).forEach((u) =>
            registerUrl(u, {
              source: 'css-reference',
              asHint: isFontRule ? 'font' : undefined,
            }),
          );
        }
      }
    }
  } catch {
    // Ignore stylesheet inspection errors
  }

  try {
    const entries = win?.performance?.getEntriesByType('resource') ?? [];
    for (const entry of entries) {
      registerUrl(entry.name, { source: 'browser-observed' });
    }
  } catch {
    // Ignore performance entry errors
  }

  return Array.from(collectedMap.values());
}
