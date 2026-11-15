import type { ResourceSource } from '../../src/utils/classify-resource.ts';

export interface ExtractedAssetCandidate {
  rawUrl: string;
  source: ResourceSource;
  asHint?: string;
  rel?: string;
  mimeHint?: string;
}

const DIRECT_ASSET_EXT_PATTERN =
  '(?:pdf|svg|png|jpe?g|jfif|webp|avif|gif|ico|bmp|tiff?|heic|heif|apng|jxl|mp4|webm|m3u8|mpd|mov|m4v|ogv|avi|mkv|flv|wmv|3gp|mp3|wav|m4a|ogg|oga|aac|flac|opus|weba|woff2?|ttf|otf|eot|vtt|srt|css|js|mjs|cjs|doc|docx|xls|xlsx|ppt|pptx|csv|epub)';

const DIRECT_ASSET_PATH_REGEX = new RegExp(`\\.${DIRECT_ASSET_EXT_PATTERN}$`, 'i');
const DIRECT_ASSET_PARAM_EXT_REGEX = new RegExp(`^\\.?${DIRECT_ASSET_EXT_PATTERN}$`, 'i');

const INLINE_SCRIPT_ABS_URL_REGEX = new RegExp(
  `(?:https?:)?\\/\\/[^\\s"'<>\\\\\\\`\\)\\}\\]\\,]+?\\.${DIRECT_ASSET_EXT_PATTERN}(?:\\?[^\\s"'<>\\\\\\\`\\)\\}\\]\\,]*)?`,
  'gi',
);

const INLINE_SCRIPT_REL_URL_REGEX = new RegExp(
  `["'\`]((?:\\/|\\.\\.?\\/)[^"'\\\`<>\\s]+?\\.${DIRECT_ASSET_EXT_PATTERN}(?:\\?[^"'\\\`<>\\s]*)?)["'\`]`,
  'gi',
);

const JSONLD_MEDIA_KEYS = new Set([
  'image',
  'images',
  'thumbnail',
  'thumbnailurl',
  'contenturl',
  'embedurl',
  'logo',
  'photo',
  'video',
  'audio',
  'associatedmedia',
  'encoding',
  'icon',
  'screenshot',
  'screenshots',
  'file',
]);

export function isDirectAssetHrefUrl(parsedHref: URL): boolean {
  if (DIRECT_ASSET_PATH_REGEX.test(parsedHref.pathname)) {
    return true;
  }

  for (const key of ['format', 'ext', 'fm', 'type', 'file', 'filename', 'download']) {
    const val = parsedHref.searchParams.get(key)?.trim();
    if (!val) continue;
    if (DIRECT_ASSET_PARAM_EXT_REGEX.test(val) || DIRECT_ASSET_PATH_REGEX.test(val)) {
      return true;
    }
  }

  return false;
}

export function extractCssAssetCandidates(cssText: string): ExtractedAssetCandidate[] {
  if (!cssText || cssText.length > 1_048_576) return [];

  const results: ExtractedAssetCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (raw: string, asHint?: string, rel?: string) => {
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, '');
    if (
      !cleaned ||
      cleaned.startsWith('#') ||
      /^(?:data:|blob:|about:|javascript:)/i.test(cleaned)
    ) {
      return;
    }
    const key = `${asHint ?? ''}|${rel ?? ''}|${cleaned}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      rawUrl: cleaned,
      source: rel === 'stylesheet' ? 'html-link' : 'css-reference',
      asHint,
      rel,
    });
  };

  // Detect @import stylesheets first
  const importRegex = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(cssText)) !== null) {
    const candidate = importMatch[2] ?? importMatch[4];
    if (candidate) {
      pushCandidate(candidate, 'style', 'stylesheet');
    }
  }

  // Extract @font-face blocks to tag font assets accurately
  const fontBlockRegex = /@font-face\s*\{([^}]*)\}/gi;
  let fontBlock: RegExpExecArray | null;
  while ((fontBlock = fontBlockRegex.exec(cssText)) !== null) {
    const blockBody = fontBlock[1];
    const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRegex.exec(blockBody)) !== null) {
      if (urlMatch[2]) {
        pushCandidate(urlMatch[2], 'font');
      }
    }
  }

  // Extract all remaining CSS url(...) references
  const genericUrlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = genericUrlRegex.exec(cssText)) !== null) {
    if (urlMatch[2]) {
      pushCandidate(urlMatch[2]);
    }
  }

  return results;
}

export function extractJsonLdAssetCandidates(jsonText: string): ExtractedAssetCandidate[] {
  const trimmed = jsonText.trim();
  if (!trimmed || trimmed.length > 512_000) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const results: ExtractedAssetCandidate[] = [];
  const seen = new Set<string>();

  const pushUrl = (raw: string, asHint?: string) => {
    const cleaned = raw.trim();
    if (!cleaned || seen.has(cleaned)) return;
    if (/^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(cleaned)) return;
    seen.add(cleaned);
    results.push({
      rawUrl: cleaned,
      source: 'html-source',
      asHint,
    });
  };

  const inferHintFromKey = (key: string): string | undefined => {
    const lower = key.toLowerCase();
    if (lower.includes('video')) return 'video';
    if (lower.includes('audio')) return 'audio';
    if (
      lower.includes('image') ||
      lower.includes('logo') ||
      lower.includes('thumb') ||
      lower.includes('photo') ||
      lower.includes('icon') ||
      lower.includes('screenshot')
    ) {
      return 'image';
    }
    return undefined;
  };

  const walk = (node: unknown, parentKey: string, inMediaContext: boolean, depth: number) => {
    if (depth > 12 || node == null) return;

    if (typeof node === 'string') {
      const candidate = node.trim();
      if (!candidate) return;
      if (inMediaContext) {
        pushUrl(candidate, inferHintFromKey(parentKey));
        return;
      }
      try {
        const parsedMaybe = new URL(candidate, 'https://placeholder.local');
        if (isDirectAssetHrefUrl(parsedMaybe)) {
          pushUrl(candidate);
        }
      } catch {
        // Ignore non-URL strings
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, parentKey, inMediaContext, depth + 1);
      }
      return;
    }

    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const typeVal = typeof obj['@type'] === 'string' ? obj['@type'].toLowerCase() : '';
      const nodeIsMediaObject =
        typeVal.includes('imageobject') ||
        typeVal.includes('videoobject') ||
        typeVal.includes('audioobject') ||
        typeVal.includes('mediaobject');

      for (const [k, v] of Object.entries(obj)) {
        const lowerKey = k.toLowerCase();
        const childMedia =
          JSONLD_MEDIA_KEYS.has(lowerKey) ||
          (nodeIsMediaObject && (lowerKey === 'url' || lowerKey === 'contenturl'));
        walk(v, lowerKey, childMedia, depth + 1);
      }
    }
  };

  walk(parsed, '', false, 0);
  return results;
}

export function extractInlineScriptAssetCandidates(
  scriptText: string,
): ExtractedAssetCandidate[] {
  if (!scriptText || scriptText.length > 512_000) return [];

  const normalized = scriptText
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u0026/g, '&');

  const results: ExtractedAssetCandidate[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const cleaned = raw.trim().replace(/[\\,;]+$/, '');
    if (!cleaned || cleaned.length > 1024 || seen.has(cleaned)) return;
    seen.add(cleaned);
    results.push({
      rawUrl: cleaned,
      source: 'html-source',
    });
  };

  let absMatch: RegExpExecArray | null;
  INLINE_SCRIPT_ABS_URL_REGEX.lastIndex = 0;
  while ((absMatch = INLINE_SCRIPT_ABS_URL_REGEX.exec(normalized)) !== null) {
    if (results.length >= 250) break;
    add(absMatch[0]);
  }

  let relMatch: RegExpExecArray | null;
  INLINE_SCRIPT_REL_URL_REGEX.lastIndex = 0;
  while ((relMatch = INLINE_SCRIPT_REL_URL_REGEX.exec(normalized)) !== null) {
    if (results.length >= 300) break;
    if (relMatch[1]) {
      add(relMatch[1]);
    }
  }

  // Also check CSS url(...) embedded inside JS templates/styles
  if (normalized.includes('url(')) {
    for (const cssCandidate of extractCssAssetCandidates(normalized)) {
      if (results.length >= 350) break;
      add(cssCandidate.rawUrl);
    }
  }

  return results;
}

export function extractManifestAssetCandidates(
  manifestJson: string,
): ExtractedAssetCandidate[] {
  if (!manifestJson || manifestJson.length > 256_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const obj = parsed as {
    icons?: Array<{ src?: unknown; type?: unknown }>;
    screenshots?: Array<{ src?: unknown; type?: unknown }>;
  };

  const results: ExtractedAssetCandidate[] = [];
  const collectList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const src = (entry as { src?: unknown }).src;
      const type = (entry as { type?: unknown }).type;
      if (typeof src === 'string' && src.trim()) {
        results.push({
          rawUrl: src.trim(),
          source: 'html-link',
          asHint: 'image',
          mimeHint: typeof type === 'string' ? type : undefined,
        });
      }
    }
  };

  collectList(obj.icons);
  collectList(obj.screenshots);
  return results;
}

export function extractM3u8AssetCandidates(
  playlistText: string,
): ExtractedAssetCandidate[] {
  if (!playlistText || playlistText.length > 512_000) return [];

  const results: ExtractedAssetCandidate[] = [];
  const seen = new Set<string>();

  const push = (raw: string, asHint?: string, mimeHint?: string) => {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    results.push({
      rawUrl: trimmed,
      source: 'html-source',
      asHint,
      mimeHint,
    });
  };

  for (const rawLine of playlistText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const uriMatch = /URI="([^"]+)"/i.exec(line);
      if (uriMatch?.[1]) {
        const isAudio = /TYPE=AUDIO/i.test(line);
        const isSub = /TYPE=SUBTITLES/i.test(line);
        push(
          uriMatch[1],
          isAudio ? 'audio' : isSub ? 'document' : 'video',
          isAudio ? 'application/vnd.apple.mpegurl' : undefined,
        );
      }
      continue;
    }

    // Variant playlist (.m3u8) — skip individual .ts segment spam if huge, keep variant playlists & media
    if (/\.m3u8(?:\?|$)/i.test(line) || results.length < 15) {
      push(
        line,
        'video',
        /\.m3u8(?:\?|$)/i.test(line) ? 'application/vnd.apple.mpegurl' : undefined,
      );
    }
  }

  return results;
}
