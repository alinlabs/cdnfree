const SKIP_SCHEMES = [
  'javascript:',
  'mailto:',
  'tel:',
  'about:',
  'blob:',
  'chrome:',
  'file:',
  'data:',
  'vbscript:',
] as const;

export type ResolveDropReason = 'unresolvable' | 'scheme';

export type ResolveOutcome =
  | { ok: true; url: URL }
  | { ok: false; reason: ResolveDropReason };

export function resolveRefWithReason(raw: string, base: URL): ResolveOutcome {
  const t = raw.trim();
  if (!t) {
    return { ok: false, reason: 'unresolvable' };
  }

  // Fragment-only references point within the same document, not an external asset
  if (t.startsWith('#')) {
    return { ok: false, reason: 'unresolvable' };
  }

  const lower = t.toLowerCase();
  if (SKIP_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    return { ok: false, reason: 'scheme' };
  }

  // Reject scheme-like values with whitespace or control characters
  if (/[\u0000-\u001F\u007F]/.test(t) || /^https?:\/\/[^\s]*\s/.test(t)) {
    return { ok: false, reason: 'unresolvable' };
  }

  try {
    const resolved = new URL(t, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return { ok: false, reason: 'scheme' };
    }
    if (!resolved.hostname) {
      return { ok: false, reason: 'unresolvable' };
    }
    resolved.hash = '';
    return { ok: true, url: resolved };
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }
}

export function resolveRef(raw: string, base: URL): URL | null {
  const outcome = resolveRefWithReason(raw, base);
  return outcome.ok ? outcome.url : null;
}

export function resolveBaseUrl(finalUrl: URL, baseHrefAttr?: string): URL {
  if (!baseHrefAttr) return finalUrl;
  const resolved = resolveRefWithReason(baseHrefAttr, finalUrl);
  return resolved.ok ? resolved.url : finalUrl;
}
