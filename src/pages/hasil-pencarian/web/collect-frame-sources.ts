import type { ResourceRecord } from '../../../types/inspection';
import {
  classifyResourceKind,
  inferMimeHintFromUrl,
} from '../../../utils/classify-resource';
import { getHostnameSafe } from '../../../utils/inspection-details';
import {
  extractCssUrls,
  extractSrcsetUrls,
  nudgeLazyElements,
  resolveSourceUrl,
  waitForDomSettle,
  waitForIframeReady,
  waitForNextPaint,
  waitForPendingImages,
  type CollectFrameOptions,
} from './frame-collection-utils';

export { waitForNextPaint, type CollectFrameOptions };

export async function waitAndCollectFrameResources(
  iframe: HTMLIFrameElement | null,
  pageUrl: string,
  options?: CollectFrameOptions,
): Promise<ResourceRecord[]> {
  if (!iframe) return [];
  if (
    options?.mode === 'engine' ||
    (iframe.getAttribute('src') || '').startsWith('/p/')
  ) {
    return [];
  }

  await waitForIframeReady(iframe, 7000);

  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }

  if (!doc) return [];

  await waitForDomSettle(doc, 1600, 350);
  await nudgeLazyElements(doc, win, options);
  await waitForPendingImages(doc, 2500);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 200));

  const collectedMap = new Map<string, ResourceRecord>();
  const visitedDocs = new Set<Document>();
  const visitedShadows = new Set<ShadowRoot>();

  const registerUrl = (
    raw: string | null | undefined,
    baseUrl: string,
    hint?: {
      source?: ResourceRecord['source'];
      rel?: string;
      asHint?: string;
      mimeHint?: string;
      posterUrl?: string;
    },
  ) => {
    if (!raw) return;
    const resolved = resolveSourceUrl(raw, baseUrl);
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

  const LAZY_DOM_ATTRS = [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-lazy',
    'data-full-src',
    'data-hi-res-src',
    'data-src-retina',
    'data-fallback-src',
    'data-thumb',
    'data-thumbnail',
    'data-cover',
  ] as const;

  const VIDEO_DATA_ATTRS = [
    'data-src',
    'data-video',
    'data-video-src',
    'data-video-url',
    'data-mp4',
    'data-webm',
    'data-hls',
    'data-stream-url',
  ] as const;

  const BG_DATA_ATTRS = [
    'data-bg',
    'data-bg-src',
    'data-background',
    'data-background-image',
  ] as const;

  const scanNodeRoot = (
    root: Document | ShadowRoot,
    targetWin: Window | null,
    baseUrl: string,
  ) => {
    root.querySelectorAll('img').forEach((el) => {
      registerUrl(el.currentSrc || el.getAttribute('src'), baseUrl, { source: 'html-img' });
      for (const attr of LAZY_DOM_ATTRS) {
        registerUrl(el.getAttribute(attr), baseUrl, { source: 'html-img' });
      }
      const srcset =
        el.getAttribute('srcset') ||
        el.getAttribute('data-srcset') ||
        el.getAttribute('data-lazy-srcset');
      if (srcset) {
        extractSrcsetUrls(srcset).forEach((u) => registerUrl(u, baseUrl, { source: 'html-img' }));
      }
    });

    root.querySelectorAll('video').forEach((el) => {
      const rawPoster = el.getAttribute('poster') || el.getAttribute('data-poster');
      const resolvedPoster = rawPoster ? resolveSourceUrl(rawPoster, baseUrl) ?? undefined : undefined;
      registerUrl(el.currentSrc || el.getAttribute('src'), baseUrl, {
        source: 'html-video',
        posterUrl: resolvedPoster,
      });
      for (const attr of VIDEO_DATA_ATTRS) {
        registerUrl(el.getAttribute(attr), baseUrl, {
          source: 'html-video',
          posterUrl: resolvedPoster,
        });
      }
      registerUrl(rawPoster, baseUrl, { source: 'html-img', asHint: 'image' });
    });

    root.querySelectorAll('[data-video], [data-video-src], [data-video-url], [data-mp4], [data-webm], [data-hls], [data-stream-url]').forEach((el) => {
      for (const attr of VIDEO_DATA_ATTRS) {
        if (attr === 'data-src') continue;
        registerUrl(el.getAttribute(attr), baseUrl, {
          source: 'html-video',
          asHint: 'video',
        });
      }
    });

    root.querySelectorAll('audio').forEach((el) => {
      registerUrl(el.currentSrc || el.getAttribute('src'), baseUrl, { source: 'html-audio' });
      registerUrl(el.getAttribute('data-src'), baseUrl, { source: 'html-audio' });
    });

    root.querySelectorAll('source').forEach((el) => {
      const parentTag = el.parentElement?.tagName.toLowerCase();
      const asHint = parentTag === 'picture' ? 'image' : parentTag;
      const rawParentPoster =
        parentTag === 'video' ? el.parentElement?.getAttribute('poster') : null;
      const resolvedPoster = rawParentPoster
        ? resolveSourceUrl(rawParentPoster, baseUrl) ?? undefined
        : undefined;
      registerUrl(el.getAttribute('src'), baseUrl, {
        source: 'html-source',
        asHint,
        posterUrl: resolvedPoster,
      });
      registerUrl(el.getAttribute('data-src'), baseUrl, {
        source: 'html-source',
        asHint,
        posterUrl: resolvedPoster,
      });
      const srcset =
        el.getAttribute('srcset') ||
        el.getAttribute('data-srcset') ||
        el.getAttribute('data-lazy-srcset');
      if (srcset) {
        extractSrcsetUrls(srcset).forEach((u) =>
          registerUrl(u, baseUrl, { source: 'html-source', asHint }),
        );
      }
    });

    root.querySelectorAll('link[href]').forEach((el) => {
      const rel = el.getAttribute('rel') ?? '';
      const asHint = el.getAttribute('as') ?? undefined;
      if (/^(dns-prefetch|preconnect|canonical|alternate)$/i.test(rel.trim())) {
        return;
      }
      registerUrl(el.getAttribute('href'), baseUrl, {
        source: 'html-link',
        rel,
        asHint,
      });
      const imgSrcset = el.getAttribute('imagesrcset');
      if (imgSrcset) {
        extractSrcsetUrls(imgSrcset).forEach((u) =>
          registerUrl(u, baseUrl, { source: 'html-link', asHint: 'image' }),
        );
      }
    });

    root.querySelectorAll('meta[content]').forEach((el) => {
      const prop = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
      const content = el.getAttribute('content');
      if (!content) return;
      if (prop.includes('video') || prop === 'twitter:player:stream') {
        registerUrl(content, baseUrl, { source: 'html-video', asHint: 'video' });
      } else if (prop.includes('audio')) {
        registerUrl(content, baseUrl, { source: 'html-audio', asHint: 'audio' });
      } else if (prop.includes('image')) {
        registerUrl(content, baseUrl, { source: 'html-img', asHint: 'image' });
      }
    });

    root.querySelectorAll('script[src]').forEach((el) => {
      registerUrl(el.getAttribute('src'), baseUrl, { source: 'html-script', asHint: 'script' });
    });

    root.querySelectorAll('image, use').forEach((el) => {
      registerUrl(el.getAttribute('href') || el.getAttribute('xlink:href'), baseUrl, {
        source: 'html-img',
        asHint: 'image',
      });
    });

    root.querySelectorAll('[data-bg], [data-bg-src], [data-background], [data-background-image]').forEach((el) => {
      for (const attr of BG_DATA_ATTRS) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        if (val.includes('url(')) {
          extractCssUrls(val).forEach((u) =>
            registerUrl(u, baseUrl, { source: 'css-reference', asHint: 'image' }),
          );
        } else {
          registerUrl(val, baseUrl, { source: 'html-img', asHint: 'image' });
        }
      }
    });

    root.querySelectorAll('[style]').forEach((el) => {
      const styleText = el.getAttribute('style');
      if (styleText && styleText.includes('url(')) {
        extractCssUrls(styleText).forEach((u) =>
          registerUrl(u, baseUrl, { source: 'css-reference' }),
        );
      }
    });

    try {
      if (targetWin && typeof targetWin.getComputedStyle === 'function') {
        const nodes = root.querySelectorAll('div, section, header, figure, article, span, a, main, aside');
        const limit = Math.min(nodes.length, 600);
        for (let i = 0; i < limit; i += 1) {
          const bg = targetWin.getComputedStyle(nodes[i]).backgroundImage;
          if (bg && bg !== 'none' && bg.includes('url(')) {
            extractCssUrls(bg).forEach((u) =>
              registerUrl(u, baseUrl, { source: 'css-reference', asHint: 'image' }),
            );
          }
        }
      }
    } catch {
      // Ignore computed style errors
    }

    const hostNodes = root.querySelectorAll('*');
    const shadowScanLimit = Math.min(hostNodes.length, 1500);
    for (let i = 0; i < shadowScanLimit; i += 1) {
      const shadow = hostNodes[i]?.shadowRoot;
      if (shadow && !visitedShadows.has(shadow)) {
        visitedShadows.add(shadow);
        scanNodeRoot(shadow, targetWin, baseUrl);
      }
    }
  };

  const collectFromDocument = (targetDoc: Document, targetWin: Window | null, baseUrl: string, depth: number) => {
    if (visitedDocs.has(targetDoc) || depth > 2) return;
    visitedDocs.add(targetDoc);

    scanNodeRoot(targetDoc, targetWin, baseUrl);

    try {
      for (const sheet of Array.from(targetDoc.styleSheets)) {
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
              registerUrl(u, baseUrl, {
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
      const entries = targetWin?.performance?.getEntriesByType('resource') ?? [];
      for (const entry of entries) {
        registerUrl(entry.name, baseUrl, { source: 'browser-observed' });
      }
    } catch {
      // Ignore performance entry errors
    }

    if (depth < 2) {
      targetDoc.querySelectorAll('iframe, frame').forEach((frameEl) => {
        try {
          const nestedWin = (frameEl as HTMLIFrameElement).contentWindow;
          const nestedDoc = (frameEl as HTMLIFrameElement).contentDocument;
          if (nestedDoc && nestedDoc.URL && nestedDoc.URL !== 'about:blank') {
            const nestedBase = resolveSourceUrl(nestedDoc.URL, baseUrl) || baseUrl;
            collectFromDocument(nestedDoc, nestedWin, nestedBase, depth + 1);
          }
        } catch {
          // Cross-origin nested frame
        }
      });
    }
  };

  collectFromDocument(doc, win, pageUrl, 0);

  return Array.from(collectedMap.values());
}
