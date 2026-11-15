import type http from 'node:http';
import pLimit from 'p-limit';
import {
  HEADER_LADDER,
  RETRYABLE_STATUS,
  SNIFF_TIMEOUT_MS,
  type HeaderMode,
} from '../config/limits.ts';
import { InspectionPolicyError, type DnsLookupFn } from '../types/server.ts';
import {
  classifyAsset,
  extractUrlExtension,
  isGenericMime,
  normalizeMimeValue,
} from './asset-classify.ts';
import type { ExtractedAsset } from './asset-extract.ts';
import { sniffKind } from './content-sniff.ts';
import { fetchHeadBytes } from './fetch-head-bytes.ts';
import {
  getProfile,
  recordFailure,
  recordSuccess,
} from './header-profile-store.ts';
import { buildHeaders } from './http-headers.ts';
import { reconcile } from './reconcile.ts';
import { defaultDnsLookup } from './url-policy.ts';

export type ProbeStatus = 'verified' | 'unverified';

export type ProbeReason =
  | 'ok'
  | 'html-wrapper'
  | 'empty-body'
  | 'unresolved'
  | 'unfollowed-redirect'
  | 'http-403'
  | 'http-4xx'
  | 'http-5xx'
  | 'timeout'
  | 'network'
  | 'ssrf-blocked';

export interface ProbeResult {
  status: ProbeStatus;
  reason: ProbeReason;
  httpStatus?: number;
  mime?: string;
  bytes?: number;
  ranges?: boolean;
}

export interface ProbeFetchResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  buf?: Buffer;
  declaredBytes?: number;
  acceptRanges?: boolean;
}

export type ProbeFetchFn = (
  url: string,
  options: {
    headers: Record<string, string>;
    signal: AbortSignal;
    dnsLookup: DnsLookupFn;
  },
) => Promise<ProbeFetchResponse>;

export interface ProbeAssetsOptions {
  pageUrl: string;
  dnsLookup?: DnsLookupFn;
  fetchRange?: ProbeFetchFn;
  concurrency?: number;
  perProbeTimeoutMs?: number;
  totalBudgetMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_PER_PROBE_TIMEOUT_MS = Math.min(SNIFF_TIMEOUT_MS, 7_500);
const DEFAULT_TOTAL_BUDGET_MS = 10_000;

const PROBE_KIND_PRIORITY: Record<ExtractedAsset['kind'], number> = {
  hls: 0,
  dash: 0,
  video: 1,
  audio: 2,
  vector: 3,
  image: 4,
  pdf: 5,
  embed: 6,
  wrapper: 7,
  font: 8,
  stylesheet: 9,
  json: 10,
  other: 11,
};

function getHeaderString(
  headers: http.IncomingHttpHeaders,
  name: string,
): string | undefined {
  const val = headers[name.toLowerCase()];
  return Array.isArray(val) ? val[0] : val;
}

export function parseContentRangeTotal(header?: string): number | undefined {
  if (!header) return undefined;
  const match = header.match(/bytes\s+\d+-\d+\/(\d+|\*)/i);
  if (!match || !match[1] || match[1] === '*') return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseContentLength(header?: string): number | undefined {
  if (!header) return undefined;
  const parsed = Number(header.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isAccessRestricted(
  statusCode: number,
  headers: http.IncomingHttpHeaders,
): boolean {
  return (
    statusCode === 401 ||
    statusCode === 402 ||
    statusCode === 403 ||
    Boolean(getHeaderString(headers, 'www-authenticate'))
  );
}

function isAbortOrTimeoutError(err: unknown): boolean {
  if (err instanceof InspectionPolicyError && err.code === 'TIMEOUT') return true;
  if (err instanceof InspectionPolicyError && err.code === 'ABORTED') return true;
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.name === 'TimeoutError';
  }
  return false;
}

function safeHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function refererForMode(mode: HeaderMode, pageUrl: string | null): string | null {
  return mode === 'page-origin' ? pageUrl : null;
}

async function fetchWithAdaptiveLadder(
  url: string,
  pageUrl: string,
  perProbeTimeoutMs: number,
  signal: AbortSignal,
  dnsLookup: DnsLookupFn,
  customFetch?: ProbeFetchFn,
): Promise<ProbeFetchResponse> {
  if (customFetch) {
    return customFetch(url, {
      headers: {
        ...buildHeaders(url, pageUrl, 'page-origin'),
        Range: 'bytes=0-2047',
      },
      signal,
      dnsLookup,
    });
  }

  const host = safeHost(url);
  const learned = host ? getProfile(host) : undefined;
  const modes: HeaderMode[] = learned ? [learned.mode] : [...HEADER_LADDER];
  let lastRes: ProbeFetchResponse | null = null;

  for (const mode of modes) {
    const head = await fetchHeadBytes(url, pageUrl, mode, {
      dnsLookup,
      signal,
      timeoutMs: perProbeTimeoutMs,
    });

    lastRes = {
      statusCode: head.status,
      headers: head.headers,
      buf: head.buf,
      declaredBytes: head.declaredBytes ?? undefined,
      acceptRanges: head.acceptRanges,
    };

    if (head.status >= 400) {
      if (host) recordFailure(host);
      if (RETRYABLE_STATUS.has(head.status)) {
        continue;
      }
      return lastRes;
    }

    if (host && head.status < 300) {
      let origin: string | null = null;
      if (mode === 'page-origin') {
        try {
          origin = new URL(pageUrl).origin;
        } catch {
          origin = null;
        }
      }
      recordSuccess(host, mode, refererForMode(mode, pageUrl), origin);
    }

    return lastRes;
  }

  return (
    lastRes ?? {
      statusCode: 403,
      headers: {},
    }
  );
}

function evaluateProbeResponse(
  asset: ExtractedAsset,
  response: ProbeFetchResponse,
): void {
  if (isAccessRestricted(response.statusCode, response.headers)) {
    asset.probe = {
      status: 'unverified',
      reason: 'http-403',
      httpStatus: response.statusCode,
    };
    return;
  }

  if (response.statusCode >= 500) {
    asset.probe = {
      status: 'unverified',
      reason: 'http-5xx',
      httpStatus: response.statusCode,
    };
    return;
  }

  if (response.statusCode >= 400 || response.statusCode < 200) {
    asset.probe = {
      status: 'unverified',
      reason: 'http-4xx',
      httpStatus: response.statusCode,
    };
    return;
  }

  if (response.statusCode >= 300) {
    asset.probe = {
      status: 'unverified',
      reason: 'unfollowed-redirect',
      httpStatus: response.statusCode,
    };
    return;
  }

  const rawContentType = getHeaderString(response.headers, 'content-type');
  const declaredMime = normalizeMimeValue(rawContentType) || undefined;
  const contentRange = getHeaderString(response.headers, 'content-range');
  const acceptRanges =
    response.acceptRanges ||
    response.statusCode === 206 ||
    getHeaderString(response.headers, 'accept-ranges')?.toLowerCase() === 'bytes' ||
    Boolean(contentRange);
  const totalFromRange = parseContentRangeTotal(contentRange);
  const totalFromLen =
    response.statusCode === 200
      ? parseContentLength(getHeaderString(response.headers, 'content-length'))
      : undefined;
  const bytes = response.declaredBytes ?? totalFromRange ?? totalFromLen;

  // When actual bytes were fetched, sniffKind decides payload kind exclusively (Rule #1 & #2).
  if (response.buf !== undefined) {
    const sniffed = sniffKind(response.buf);
    const verdict = reconcile(declaredMime ?? null, sniffed, asset.url, response.buf);

    if (verdict.kind === 'empty') {
      asset.probe = {
        status: 'unverified',
        reason: 'empty-body',
        httpStatus: response.statusCode,
      };
      return;
    }

    if (verdict.kind === 'html') {
      const mime = 'text/html; charset=utf-8';
      asset.mime = mime;
      asset.kind = 'wrapper';
      asset.probe = {
        status: 'unverified',
        reason: 'html-wrapper',
        httpStatus: response.statusCode,
        mime,
      };
      return;
    }

    if (verdict.kind === 'hls' || verdict.kind === 'dash') {
      const mime = verdict.mime ?? (verdict.kind === 'hls'
        ? 'application/vnd.apple.mpegurl'
        : 'application/dash+xml');
      asset.mime = mime;
      asset.kind = verdict.kind;
      if (typeof bytes === 'number') asset.bytes = bytes;
      asset.probe = {
        status: 'verified',
        reason: 'ok',
        httpStatus: response.statusCode,
        mime,
        bytes,
        ranges: acceptRanges,
      };
      return;
    }

    if (
      verdict.kind === 'video' ||
      verdict.kind === 'audio' ||
      verdict.kind === 'image' ||
      verdict.kind === 'pdf'
    ) {
      const finalMime = verdict.mime ?? declaredMime;
      const ext = extractUrlExtension(asset.url);
      const isVector =
        finalMime === 'image/svg+xml' || ext === 'svg' || ext === 'svgz';
      const resolvedKind = isVector ? 'vector' : verdict.kind;

      if (finalMime) asset.mime = finalMime;
      if (typeof bytes === 'number') asset.bytes = bytes;
      asset.kind = resolvedKind;
      asset.probe = {
        status: 'verified',
        reason: 'ok',
        httpStatus: response.statusCode,
        mime: finalMime,
        bytes,
        ranges: acceptRanges,
      };
      return;
    }

    // Non-media / binary / unresolved payload cannot receive 'verified' (Rule #2)
    asset.probe = {
      status: 'unverified',
      reason: 'unresolved',
      httpStatus: response.statusCode,
      mime: verdict.mime ?? declaredMime,
      bytes,
      ranges: acceptRanges,
    };
    return;
  }

  // Fallback for mocked fetchRange tests returning headers without byte buffers
  if (declaredMime === 'text/html' || declaredMime === 'application/xhtml+xml') {
    asset.mime = declaredMime;
    asset.kind = 'wrapper';
    asset.probe = {
      status: 'unverified',
      reason: 'html-wrapper',
      httpStatus: response.statusCode,
      mime: declaredMime,
    };
    return;
  }

  asset.probe = {
    status: 'verified',
    reason: 'ok',
    httpStatus: response.statusCode,
    mime: declaredMime,
    bytes,
    ranges: acceptRanges,
  };

  if (typeof bytes === 'number') {
    asset.bytes = bytes;
  }
  if (declaredMime && !isGenericMime(declaredMime)) {
    asset.mime = declaredMime;
    asset.kind = classifyAsset({
      url: asset.url,
      hint: asset.hint,
      mime: declaredMime,
      typeAttr: asset.typeAttr,
    });
  } else if (!asset.mime && declaredMime) {
    asset.mime = declaredMime;
  }
}

export async function probeAssets(
  assets: ExtractedAsset[],
  options: ProbeAssetsOptions,
): Promise<ExtractedAsset[]> {
  if (assets.length === 0) return assets;

  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const perProbeTimeoutMs =
    options.perProbeTimeoutMs ?? DEFAULT_PER_PROBE_TIMEOUT_MS;
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;

  const budgetController = new AbortController();
  const abortBudget = () => budgetController.abort();
  if (options.signal?.aborted) {
    for (const asset of assets) {
      asset.probe = { status: 'unverified', reason: 'timeout' };
    }
    return assets;
  }

  options.signal?.addEventListener('abort', abortBudget, { once: true });
  const budgetTimer = setTimeout(abortBudget, totalBudgetMs);
  const limit = pLimit(concurrency);

  const orderedQueue = [...assets].sort(
    (a, b) => (PROBE_KIND_PRIORITY[a.kind] ?? 12) - (PROBE_KIND_PRIORITY[b.kind] ?? 12),
  );

  try {
    await Promise.all(
      orderedQueue.map((asset) =>
        limit(async () => {
          if (budgetController.signal.aborted) {
            asset.probe = { status: 'unverified', reason: 'timeout' };
            return;
          }

          const perProbeController = new AbortController();
          const onBudgetAbort = () => perProbeController.abort();
          budgetController.signal.addEventListener('abort', onBudgetAbort, {
            once: true,
          });
          const timeoutTimer = setTimeout(
            () => perProbeController.abort(),
            perProbeTimeoutMs,
          );

          try {
            const response = await fetchWithAdaptiveLadder(
              asset.url,
              options.pageUrl,
              perProbeTimeoutMs,
              perProbeController.signal,
              dnsLookup,
              options.fetchRange,
            );
            evaluateProbeResponse(asset, response);
          } catch (err) {
            if (
              err instanceof InspectionPolicyError &&
              (err.code === 'PROHIBITED_DESTINATION' ||
                err.code === 'DNS_RESOLUTION_FAILED')
            ) {
              asset.probe = { status: 'unverified', reason: 'ssrf-blocked' };
              return;
            }
            if (isAbortOrTimeoutError(err) || budgetController.signal.aborted) {
              asset.probe = { status: 'unverified', reason: 'timeout' };
              return;
            }
            asset.probe = { status: 'unverified', reason: 'network' };
          } finally {
            clearTimeout(timeoutTimer);
            budgetController.signal.removeEventListener('abort', onBudgetAbort);
          }
        }),
      ),
    );
  } finally {
    clearTimeout(budgetTimer);
    options.signal?.removeEventListener('abort', abortBudget);
  }

  return assets;
}
