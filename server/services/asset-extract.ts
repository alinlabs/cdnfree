import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { classifyAsset, extractUrlExtension } from './asset-classify.ts';
import { resolveBaseUrl, resolveRefWithReason } from './asset-resolve.ts';
import { EXTRACT_RULES, type AssetKind } from './asset-rules.ts';
import {
  extractInlineScriptAssetCandidates,
  extractJsonLdAssetCandidates,
} from './deep-asset-extractor.ts';
import type { ProbeResult } from './asset-probe.ts';

export type DropReason = 'unresolvable' | 'scheme' | 'duplicate' | 'budget';

export interface ExtractedAsset {
  id: string;
  url: string;
  host: string;
  kind: AssetKind;
  hint: AssetKind;
  tag: string;
  attr: string;
  mime?: string;
  typeAttr?: string;
  bytes?: number;
  posterUrl?: string;
  probe?: ProbeResult | null;
}

export interface ExtractResult {
  assets: ExtractedAsset[];
  byKind: Record<AssetKind, number>;
  dropped: Array<{ reason: DropReason; count: number }>;
  candidates: number;
  resolved: number;
  deduped: number;
}

export const MAX_ASSET_BUDGET = 1500;

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/gi;
const JSON_LD_ASSET_KEYS = new Set([
  'image',
  'thumbnailurl',
  'contenturl',
  'embedurl',
  'logo',
]);
const DIRECT_LINK_ASSET_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp',
  'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'm3u8', 'mpd',
  'mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac', 'opus',
  'woff', 'woff2', 'ttf', 'otf', 'pdf', 'css',
]);

function makeAssetId(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function createEmptyByKind(): Record<AssetKind, number> {
  return {
    image: 0,
    vector: 0,
    video: 0,
    audio: 0,
    font: 0,
    stylesheet: 0,
    pdf: 0,
    json: 0,
    other: 0,
  };
}

export function extractCssUrlValues(cssText: string): Array<{
  rawUrl: string;
  hint: AssetKind;
}> {
  const results: Array<{ rawUrl: string; hint: AssetKind }> = [];

  for (const match of cssText.matchAll(CSS_IMPORT_PATTERN)) {
    const raw = match[1]?.trim();
    if (raw) {
      results.push({ rawUrl: raw, hint: 'stylesheet' });
    }
  }

  for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
    const raw = match[2]?.trim();
    if (!raw) continue;
    const ext = extractUrlExtension(
      raw.startsWith('http://') || raw.startsWith('https://')
        ? raw
        : `https://placeholder.local/${raw.replace(/^\/+/, '')}`,
    );
    const hint: AssetKind =
      ext === 'svg' || ext === 'svgz'
        ? 'vector'
        : ext === 'woff' || ext === 'woff2' || ext === 'ttf' || ext === 'otf' || ext === 'eot'
          ? 'font'
          : 'image';
    results.push({ rawUrl: raw, hint });
  }

  return results;
}

export function splitSrcsetCandidates(rawSrcset: string): string[] {
  const candidates: string[] = [];
  for (const part of rawSrcset.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const urlPart = trimmed.split(/\s+/)[0];
    if (urlPart) {
      candidates.push(urlPart);
    }
  }
  return candidates;
}

function collectJsonLdAssets(
  value: unknown,
  out: Array<{ rawUrl: string; hint: AssetKind }>,
  currentKey = '',
): void {
  if (!value) return;
  if (typeof value === 'string') {
    if (JSON_LD_ASSET_KEYS.has(currentKey)) {
      const hint: AssetKind =
        currentKey === 'contenturl' || currentKey === 'embedurl'
          ? 'video'
          : 'image';
      out.push({ rawUrl: value, hint });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJsonLdAssets(entry, out, currentKey);
    }
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalizedType =
      typeof record['@type'] === 'string' ? record['@type'].toLowerCase() : '';
    const objectHint: AssetKind =
      normalizedType.includes('video')
        ? 'video'
        : normalizedType.includes('audio')
          ? 'audio'
          : 'image';

    for (const [key, child] of Object.entries(record)) {
      const lowerKey = key.toLowerCase();
      if (JSON_LD_ASSET_KEYS.has(lowerKey)) {
        if (typeof child === 'string') {
          out.push({
            rawUrl: child,
            hint: lowerKey === 'contenturl' || lowerKey === 'embedurl' ? objectHint : 'image',
          });
        } else {
          collectJsonLdAssets(child, out, lowerKey);
        }
      } else if (
        lowerKey === 'url' &&
        JSON_LD_ASSET_KEYS.has(currentKey) &&
        typeof child === 'string'
      ) {
        out.push({ rawUrl: child, hint: objectHint });
      } else {
        collectJsonLdAssets(child, out, lowerKey);
      }
    }
  }
}

export function extractMpdAssetUrls(mpdText: string): string[] {
  const urls: string[] = [];
  for (const match of mpdText.matchAll(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi)) {
    const raw = match[1]?.trim();
    if (raw) urls.push(raw);
  }
  for (const match of mpdText.matchAll(/\b(?:media|initialization)="([^"]+)"/gi)) {
    const raw = match[1]?.trim();
    if (raw && !raw.includes('$')) urls.push(raw);
  }
  return urls;
}

export function extract(html: string, finalUrl: URL): ExtractResult {
  const $ = cheerio.load(html);
  const baseAttr = $('base[href]').first().attr('href');
  const baseUrl = resolveBaseUrl(finalUrl, baseAttr);

  const byUrl = new Map<string, ExtractedAsset>();
  const dropCounts: Record<DropReason, number> = {
    unresolvable: 0,
    scheme: 0,
    duplicate: 0,
    budget: 0,
  };
  let candidates = 0;
  let resolved = 0;

  const addCandidate = (
    raw: string | undefined,
    meta: {
      hint: AssetKind;
      tag: string;
      attr: string;
      typeAttr?: string;
      posterUrl?: string;
    },
  ) => {
    if (raw === undefined) return;
    candidates += 1;

    const outcome = resolveRefWithReason(raw, baseUrl);
    if (!outcome.ok) {
      dropCounts[outcome.reason] += 1;
      return;
    }

    resolved += 1;
    const canonicalUrl = outcome.url.href;

    const existing = byUrl.get(canonicalUrl);
    if (existing) {
      dropCounts.duplicate += 1;
      if (!existing.typeAttr && meta.typeAttr) {
        existing.typeAttr = meta.typeAttr;
        existing.kind = classifyAsset({
          url: canonicalUrl,
          hint: existing.hint,
          typeAttr: existing.typeAttr,
        });
      }
      if (!existing.posterUrl && meta.posterUrl) {
        existing.posterUrl = meta.posterUrl;
      }
      return;
    }

    if (byUrl.size >= MAX_ASSET_BUDGET) {
      dropCounts.budget += 1;
      return;
    }

    const kind = classifyAsset({
      url: canonicalUrl,
      hint: meta.hint,
      typeAttr: meta.typeAttr,
    });

    byUrl.set(canonicalUrl, {
      id: makeAssetId(canonicalUrl),
      url: canonicalUrl,
      host: outcome.url.hostname.toLowerCase(),
      kind,
      hint: meta.hint,
      tag: meta.tag,
      attr: meta.attr,
      typeAttr: meta.typeAttr || undefined,
      posterUrl: kind === 'video' ? meta.posterUrl : undefined,
      probe: null,
    });
  };

  const scanDocument = (doc: cheerio.CheerioAPI) => {
    const visitedAttrs = new WeakMap<object, Set<string>>();
    const markAttrVisited = (el: object, attr: string): boolean => {
      let set = visitedAttrs.get(el);
      if (!set) {
        set = new Set<string>();
        visitedAttrs.set(el, set);
      }
      if (set.has(attr)) return false;
      set.add(attr);
      return true;
    };

    for (const rule of EXTRACT_RULES) {
      doc(rule.sel).each((_, el) => {
        if (!markAttrVisited(el as object, rule.attr)) return;
        const node = doc(el);
        const val = node.attr(rule.attr);
        if (val === undefined) return;

        const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? 'el';
        const typeAttr = node.attr('type')?.trim();
        const asAttr = node.attr('as')?.trim().toLowerCase();
        const effectiveHint: AssetKind =
          rule.hint === 'other' && asAttr
            ? asAttr === 'image'
              ? 'image'
              : asAttr === 'video'
                ? 'video'
                : asAttr === 'audio'
                  ? 'audio'
                  : asAttr === 'font'
                    ? 'font'
                    : asAttr === 'style'
                      ? 'stylesheet'
                      : rule.hint
            : rule.hint;

        let posterUrl: string | undefined;
        if (effectiveHint === 'video') {
          const videoEl = tag === 'source' ? node.parent('video') : node;
          const rawPoster = videoEl.attr('poster') || videoEl.attr('data-poster');
          if (rawPoster) {
            const posterRes = resolveRefWithReason(rawPoster, baseUrl);
            if (posterRes.ok) {
              posterUrl = posterRes.url.href;
            }
          }
        }

        if (rule.srcset) {
          for (const candidate of splitSrcsetCandidates(val)) {
            addCandidate(candidate, {
              hint: effectiveHint,
              tag,
              attr: rule.attr,
              typeAttr,
              posterUrl,
            });
          }
          return;
        }

        if (rule.css) {
          for (const cssItem of extractCssUrlValues(val)) {
            addCandidate(cssItem.rawUrl, {
              hint: cssItem.hint,
              tag,
              attr: rule.attr,
            });
          }
          return;
        }

        // Handle data-bg / data-background url(...) syntax safely
        if (rule.attr.startsWith('data-bg') && val.includes('url(')) {
          for (const cssItem of extractCssUrlValues(val)) {
            addCandidate(cssItem.rawUrl, {
              hint: cssItem.hint,
              tag,
              attr: rule.attr,
            });
          }
          return;
        }

        addCandidate(val, {
          hint: effectiveHint,
          tag,
          attr: rule.attr,
          typeAttr,
          posterUrl,
        });
      });
    }

    // Inline <style> blocks
    doc('style').each((_, el) => {
      const cssText = doc(el).html();
      if (!cssText) return;
      for (const cssItem of extractCssUrlValues(cssText)) {
        addCandidate(cssItem.rawUrl, {
          hint: cssItem.hint,
          tag: 'style',
          attr: 'text',
        });
      }
    });

    // JSON-LD, hydration JSON (e.g. __NEXT_DATA__), and inline <script> media blocks
    doc('script:not([src])').each((_, el) => {
      const type = (doc(el).attr('type') ?? '').toLowerCase();
      const rawText = doc(el).html()?.trim();
      if (!rawText) return;

      if (type.includes('ld+json')) {
        try {
          const parsed = JSON.parse(rawText) as unknown;
          const jsonAssets: Array<{ rawUrl: string; hint: AssetKind }> = [];
          collectJsonLdAssets(parsed, jsonAssets);
          for (const item of jsonAssets) {
            addCandidate(item.rawUrl, {
              hint: item.hint,
              tag: 'script',
              attr: 'ld+json',
            });
          }
        } catch {
          // Ignore malformed JSON-LD blocks
        }
        return;
      }

      if (type === 'application/json') {
        for (const item of extractJsonLdAssetCandidates(rawText)) {
          const hint: AssetKind =
            item.asHint === 'video'
              ? 'video'
              : item.asHint === 'audio'
                ? 'audio'
                : item.asHint === 'image'
                  ? 'image'
                  : 'other';
          addCandidate(item.rawUrl, {
            hint,
            tag: 'script',
            attr: 'json',
          });
        }
        return;
      }

      if (!type || type.includes('javascript') || type === 'module') {
        for (const item of extractInlineScriptAssetCandidates(rawText)) {
          addCandidate(item.rawUrl, {
            hint: 'other',
            tag: 'script',
            attr: 'inline',
          });
        }
      }
    });

    // Case-insensitive <a href> direct asset links fallback
    doc('a[href]').each((_, el) => {
      const rawHref = doc(el).attr('href');
      if (!rawHref) return;
      const preview = resolveRefWithReason(rawHref, baseUrl);
      if (!preview.ok) return;
      const ext = extractUrlExtension(preview.url.href);
      if (ext && DIRECT_LINK_ASSET_EXTS.has(ext) && !byUrl.has(preview.url.href)) {
        addCandidate(rawHref, {
          hint: classifyAsset({ url: preview.url.href }),
          tag: 'a',
          attr: 'href',
        });
      }
    });
  };

  scanDocument($);

  // Re-parse <noscript> and <template> raw HTML fragments
  const hiddenFragments: string[] = [];
  $('noscript, template').each((_, el) => {
    const inner = $(el).html();
    if (inner && inner.trim()) {
      hiddenFragments.push(inner);
    }
  });

  for (const fragment of hiddenFragments) {
    const fragmentDoc = cheerio.load(fragment);
    scanDocument(fragmentDoc);
  }

  const assets = Array.from(byUrl.values());
  const byKind = createEmptyByKind();
  for (const asset of assets) {
    byKind[asset.kind] += 1;
  }

  const dropped: Array<{ reason: DropReason; count: number }> = (
    ['unresolvable', 'scheme', 'duplicate', 'budget'] as const
  )
    .filter((reason) => dropCounts[reason] > 0)
    .map((reason) => ({ reason, count: dropCounts[reason] }));

  return {
    assets,
    byKind,
    dropped,
    candidates,
    resolved,
    deduped: assets.length,
  };
}
