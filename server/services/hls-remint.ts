import type { DnsLookupFn } from '../types/server.ts';
import type { InspectionStore } from './inspection-store.ts';
import { inspectUrlTarget } from './redirect-inspector.ts';

export interface ReMintResult {
  ok: boolean;
  url: string | null;
}

export async function reMintPlaylist(
  store: InspectionStore,
  sid: string,
  assetId: string,
  options: { dnsLookup?: DnsLookupFn; signal?: AbortSignal } = {},
): Promise<ReMintResult> {
  const inspection = store.get(sid);
  if (!inspection?.submittedUrl) {
    return { ok: false, url: null };
  }

  const targetAsset = inspection.resources.find((r) => r.id === assetId);
  if (!targetAsset) {
    return { ok: false, url: null };
  }

  let oldPathname = '';
  try {
    oldPathname = new URL(targetAsset.url).pathname;
  } catch {
    oldPathname = '';
  }

  try {
    const refreshed = await inspectUrlTarget(inspection.submittedUrl, {
      dnsLookup: options.dnsLookup,
      signal: options.signal,
      includeStaticLinks: false,
      includeResources: true,
    });

    const hlsCandidates = refreshed.resources.filter(
      (r) =>
        r.assetKind === 'hls' ||
        /\.m3u8(?:$|[?#])/i.test(r.url) ||
        /mpegurl/i.test(r.mimeType ?? ''),
    );

    if (hlsCandidates.length === 0) {
      return { ok: false, url: null };
    }

    const matched =
      hlsCandidates.find((c) => {
        try {
          return new URL(c.url).pathname === oldPathname;
        } catch {
          return false;
        }
      }) ?? hlsCandidates[0];

    targetAsset.url = matched.url;
    targetAsset.host = matched.host;
    if (matched.referer) targetAsset.referer = matched.referer;
    return { ok: true, url: matched.url };
  } catch {
    return { ok: false, url: null };
  }
}
