import * as cheerio from 'cheerio';
import {
  buildAssetProxyUrl,
  buildFrameProxyUrl,
  isExternalSiteUrl,
  normalizeProxyTarget,
  type FrameProxyUrlOptions,
} from './urlcodec.ts';

const ASSET_ATTRS: Record<string, string[]> = {
  link: ['href'],
  script: ['src'],
  img: ['src', 'data-src', 'data-original', 'data-lazy-src'],
  source: ['src', 'data-src'],
  video: ['src', 'poster', 'data-src'],
  audio: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  use: ['href', 'xlink:href'],
  image: ['href', 'xlink:href'],
  body: ['background'],
};

const FRAME_ATTRS: Record<string, string[]> = {
  a: ['href'],
  area: ['href'],
  iframe: ['src'],
  frame: ['src'],
  form: ['action'],
  input: ['formaction'],
  button: ['formaction'],
};

const SRCSET_ATTRS = ['srcset', 'data-srcset', 'imagesrcset'];

export function rewriteSrcset(
  value: string,
  base: string,
  origin: string,
  sessionId?: string,
): string {
  return value
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const [rawUrl, ...descriptors] = trimmed.split(/\s+/);
      try {
        const abs = normalizeProxyTarget(rawUrl, base);
        return [buildAssetProxyUrl(origin, abs, sessionId), ...descriptors].join(' ');
      } catch {
        return trimmed;
      }
    })
    .join(', ');
}

export function rewriteCssUrls(
  css: string,
  base: string,
  origin: string,
  sessionId?: string,
): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_match, quote: string, rawUrl: string) => {
      const cleaned = rawUrl.trim();
      if (/^(data:|blob:|#)/i.test(cleaned)) {
        return `url(${quote}${rawUrl}${quote})`;
      }
      try {
        const abs = normalizeProxyTarget(cleaned, base);
        return `url("${buildAssetProxyUrl(origin, abs, sessionId)}")`;
      } catch {
        return `url(${quote}${rawUrl}${quote})`;
      }
    })
    .replace(
      /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi,
      (match, _quote: string, rawUrl: string) => {
        try {
          const abs = normalizeProxyTarget(rawUrl.trim(), base);
          return `@import "${buildAssetProxyUrl(origin, abs, sessionId)}"`;
        } catch {
          return match;
        }
      },
    );
}

export function rewriteM3u8Playlist(
  playlist: string,
  targetUrl: string,
  origin: string,
  sessionId?: string,
): string {
  const base = targetUrl.replace(/[^/]+$/, '');
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (full, rawUri: string) => {
          try {
            const abs = normalizeProxyTarget(rawUri, base);
            return `URI="${buildAssetProxyUrl(origin, abs, sessionId)}"`;
          } catch {
            return full;
          }
        });
      }
      try {
        const abs = normalizeProxyTarget(trimmed, base);
        return buildAssetProxyUrl(origin, abs, sessionId);
      } catch {
        return line;
      }
    })
    .join('\n');
}

export function rewriteEsModuleSpecifiers(
  js: string,
  targetUrl: string,
  origin: string,
  sessionId?: string,
): string {
  const rewriteSpecifier = (specifier: string): string | null => {
    const trimmed = specifier.trim();
    if (
      !trimmed.startsWith('./') &&
      !trimmed.startsWith('../') &&
      !trimmed.startsWith('/') &&
      !trimmed.startsWith('http://') &&
      !trimmed.startsWith('https://')
    ) {
      return null;
    }
    try {
      const abs = normalizeProxyTarget(trimmed, targetUrl);
      return buildAssetProxyUrl(origin, abs, sessionId);
    } catch {
      return null;
    }
  };

  let rewritten = js.replace(
    /(\b(?:import|export)\b[^;'"`()]*?\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]+|\/[^'"]+|https?:\/\/[^'"]+)\2/g,
    (full, prefix: string, quote: string, spec: string) => {
      const next = rewriteSpecifier(spec);
      return next ? `${prefix}${quote}${next}${quote}` : full;
    },
  );

  rewritten = rewritten.replace(
    /(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+|\/[^'"]+|https?:\/\/[^'"]+)\2(\s*\))/g,
    (full, prefix: string, quote: string, spec: string, suffix: string) => {
      const next = rewriteSpecifier(spec);
      return next ? `${prefix}${quote}${next}${quote}${suffix}` : full;
    },
  );

  rewritten = rewritten.replace(
    /(?<![.\w$])import\.meta\.url(?![\w$])/g,
    JSON.stringify(targetUrl),
  );

  return rewritten;
}

export interface RewriteHtmlOptions {
  bypassExternalLinks?: boolean;
  rootUrl?: string;
  mode?: 'engine' | 'light';
}

export interface RewriteHtmlStats {
  links: number;
  assets: number;
}

const INLINE_EVENT_ATTRS = [
  'onclick',
  'onmousedown',
  'onmouseup',
  'ontouchstart',
  'ontouchend',
];

function neutralizeInlineExternalLocations(
  code: string,
  targetUrl: string,
  rootSiteUrl: string,
): string {
  return code.replace(
    /(?:\b(?:window|top|parent|self)\.)?\blocation(?:\.href)?\s*=\s*(['"])(https?:\/\/[^'"]+|\/\/[^'"]+)\1/gi,
    (full, quote: string, rawUrl: string) => {
      try {
        const abs = normalizeProxyTarget(rawUrl, targetUrl);
        if (isExternalSiteUrl(abs, rootSiteUrl)) {
          return `window.__cdnfreeBypassExt(${quote}${abs}${quote})`;
        }
      } catch {
        // Keep original handler text on parse errors
      }
      return full;
    },
  );
}

export function rewriteHtmlDocument(
  html: string,
  targetUrl: string,
  origin: string,
  shimScript: string,
  sessionId?: string,
  options?: RewriteHtmlOptions,
): string {
  return rewriteHtmlDocumentWithStats(
    html,
    targetUrl,
    origin,
    shimScript,
    sessionId,
    options,
  ).html;
}

export function rewriteHtmlDocumentWithStats(
  html: string,
  targetUrl: string,
  origin: string,
  shimScript: string,
  sessionId?: string,
  options?: RewriteHtmlOptions,
): { html: string; stats: RewriteHtmlStats } {
  const $ = cheerio.load(html);
  const mode = options?.mode ?? 'light';
  const bypassExternal =
    mode === 'light' && (options?.bypassExternalLinks ?? false);
  const rootSiteUrl = options?.rootUrl || targetUrl;
  const frameUrlOptions: FrameProxyUrlOptions | undefined = options
    ? { extBypass: bypassExternal, rootUrl: rootSiteUrl }
    : undefined;
  let rewrittenLinks = 0;
  let rewrittenAssets = 0;

  $('meta[http-equiv]').each((_idx, el) => {
    const val = ($(el).attr('http-equiv') || '').toLowerCase();
    if (val.includes('content-security-policy') || val.includes('x-frame-options')) {
      $(el).remove();
      return;
    }
    if (val === 'refresh') {
      const content = $(el).attr('content');
      if (content) {
        let removeExternalRefresh = false;
        const updated = content.replace(
          /(url\s*=\s*['"]?)([^'";\s]+)(['"]?)/i,
          (full, pre: string, rawUrl: string, post: string) => {
            try {
              const abs = normalizeProxyTarget(rawUrl, targetUrl);
              if (bypassExternal && isExternalSiteUrl(abs, rootSiteUrl)) {
                removeExternalRefresh = true;
                return full;
              }
              return `${pre}${buildFrameProxyUrl(origin, abs, sessionId, frameUrlOptions)}${post}`;
            } catch {
              return full;
            }
          },
        );
        if (removeExternalRefresh) {
          $(el).remove();
        } else {
          $(el).attr('content', updated);
        }
      }
    }
  });

  if ($('head').length === 0) {
    $('html').prepend('<head></head>');
  }

  let docBaseUrl = targetUrl;
  const rawBaseHref = $('base[href]').first().attr('href')?.trim();
  if (rawBaseHref && !/^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(rawBaseHref)) {
    try {
      docBaseUrl = normalizeProxyTarget(rawBaseHref, targetUrl);
    } catch {
      docBaseUrl = targetUrl;
    }
  }

  $('base').remove();
  $('[integrity]').removeAttr('integrity');
  $('[crossorigin]').removeAttr('crossorigin');

  $('script[type="importmap"]').each((_idx, el) => {
    const rawJson = $(el).html();
    if (!rawJson) return;
    try {
      const parsed = JSON.parse(rawJson) as {
        imports?: Record<string, string>;
        scopes?: Record<string, Record<string, string>>;
      };
      const mapEntries = (mapObj?: Record<string, string>) => {
        if (!mapObj || typeof mapObj !== 'object') return;
        for (const [k, v] of Object.entries(mapObj)) {
          if (typeof v !== 'string') continue;
          if (/^(\.\/|\.\.\/|\/|https?:\/\/)/i.test(v.trim())) {
            try {
              const abs = normalizeProxyTarget(v.trim(), docBaseUrl);
              mapObj[k] = buildAssetProxyUrl(origin, abs, sessionId);
            } catch {
              // ignore non-URL bare specifier
            }
          }
        }
      };
      mapEntries(parsed.imports);
      if (parsed.scopes && typeof parsed.scopes === 'object') {
        for (const scopeMap of Object.values(parsed.scopes)) {
          mapEntries(scopeMap);
        }
      }
      $(el).html(JSON.stringify(parsed));
    } catch {
      // keep malformed importmap untouched
    }
  });

  for (const [tag, attrs] of Object.entries(ASSET_ATTRS)) {
    $(tag).each((_idx, el) => {
      for (const attr of attrs) {
        const val = $(el).attr(attr);
        if (!val || /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(val.trim())) {
          continue;
        }
        try {
          const abs = normalizeProxyTarget(val, docBaseUrl);
          $(el).attr(attr, buildAssetProxyUrl(origin, abs, sessionId));
          rewrittenAssets += 1;
        } catch {
          // Leave malformed attribute unchanged
        }
      }
    });
  }

  for (const [tag, attrs] of Object.entries(FRAME_ATTRS)) {
    $(tag).each((_idx, el) => {
      const targetAttr = ($(el).attr('target') || '').trim().toLowerCase();
      if (targetAttr && targetAttr !== '_self') {
        $(el).removeAttr('target');
      }
      const formTargetAttr = ($(el).attr('formtarget') || '').trim().toLowerCase();
      if (formTargetAttr && formTargetAttr !== '_self') {
        $(el).removeAttr('formtarget');
      }
      if (tag === 'a' || tag === 'area') {
        $(el).removeAttr('ping');
      }
      for (const attr of attrs) {
        const val = $(el).attr(attr);
        if (!val || /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(val.trim())) {
          continue;
        }
        try {
          const abs = normalizeProxyTarget(val, docBaseUrl);
          if (
            bypassExternal &&
            tag !== 'iframe' &&
            tag !== 'frame' &&
            isExternalSiteUrl(abs, rootSiteUrl)
          ) {
            $(el).attr('data-cdnfree-external', '1');
          }
          $(el).attr(attr, buildFrameProxyUrl(origin, abs, sessionId, frameUrlOptions));
          rewrittenLinks += 1;
        } catch {
          // Leave malformed attribute unchanged
        }
      }
    });
  }

  if (bypassExternal) {
    for (const evtAttr of INLINE_EVENT_ATTRS) {
      $(`[${evtAttr}]`).each((_idx, el) => {
        const code = $(el).attr(evtAttr);
        if (code && /location/i.test(code)) {
          $(el).attr(evtAttr, neutralizeInlineExternalLocations(code, docBaseUrl, rootSiteUrl));
        }
      });
    }
  }

  $('*').each((_idx, el) => {
    for (const attr of SRCSET_ATTRS) {
      const val = $(el).attr(attr);
      if (val) {
        $(el).attr(attr, rewriteSrcset(val, docBaseUrl, origin, sessionId));
      }
    }
    const inlineStyle = $(el).attr('style');
    if (inlineStyle && inlineStyle.includes('url(')) {
      $(el).attr('style', rewriteCssUrls(inlineStyle, docBaseUrl, origin, sessionId));
    }
  });

  $('style').each((_idx, el) => {
    const cssText = $(el).html();
    if (cssText) {
      $(el).html(rewriteCssUrls(cssText, docBaseUrl, origin, sessionId));
    }
  });

  if (mode !== 'engine' && shimScript) {
    $('head').prepend(shimScript);
  }

  return {
    html: $.html(),
    stats: { links: rewrittenLinks, assets: rewrittenAssets },
  };
}
