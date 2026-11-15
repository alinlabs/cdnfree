import type http from 'node:http';
import pLimit from 'p-limit';
import { InspectionPolicyError, type DnsLookupFn } from '../types/server.ts';
import { classifyAsset, isGenericMime, normalizeMimeValue } from './asset-classify.ts';
import type { ExtractedAsset } from './asset-extract.ts';
import { safeProxyFetch } from './proxy/safe-proxy-fetch.ts';
import { defaultDnsLookup } from './url-policy.ts';

export type ProbeStatus = 'verified' | 'unverified';

export type ProbeReason =
  | 'ok'
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

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_PER_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_BUDGET_MS = 7_500;

const PROBE_KIND_PRIORITY: Record<ExtractedAsset['kind'], number> = {
  video: 0,
  audio: 1,
  vector: 2,
  image: 3,
  pdf: 4,
  font: 5,
  stylesheet: 6,
  json: 7,
  other: 8,
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
  if (err instanceof InspectionPolicyError && err.code === 'TIMEOUT') {
    return true;
  }
  if (err instanceof InspectionPolicyError && err.code === 'ABORTED') {
    return true;
  }
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.name === 'TimeoutError';
  }
  return false;
}

async function defaultProbeFetch(
  url: string,
  options: {
    headers: Record<string, string>;
    signal: AbortSignal;
    dnsLookup: DnsLookupFn;
  },
): Promise<ProbeFetchResponse> {
  const res = await safeProxyFetch(url, {
    method: 'GET',
    range: 'bytes=0-1023',
    headers: options.headers,
    stream: true,
    timeoutMs: DEFAULT_PER_PROBE_TIMEOUT_MS,
    dnsLookup: options.dnsLookup,
    signal: options.signal,
  });
  res.cleanup?.();
  return {
    statusCode: res.statusCode,
    headers: res.headers,
  };
}

export async function probeAssets(
  assets: ExtractedAsset[],
  options: ProbeAssetsOptions,
): Promise<ExtractedAsset[]> {
  if (assets.length === 0) return assets;

  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const fetchRange = options.fetchRange ?? defaultProbeFetch;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const perProbeTimeoutMs = options.perProbeTimeoutMs ?? DEFAULT_PER_PROBE_TIMEOUT_MS;
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
    (a, b) => (PROBE_KIND_PRIORITY[a.kind] ?? 9) - (PROBE_KIND_PRIORITY[b.kind] ?? 9),
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
            const response = await fetchRange(asset.url, {
              headers: {
                Range: 'bytes=0-1023',
                Accept: '*/*',
                Referer: options.pageUrl,
                'User-Agent': DESKTOP_UA,
              },
              signal: perProbeController.signal,
              dnsLookup,
            });

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

            const rawContentType = getHeaderString(response.headers, 'content-type');
            const mime = normalizeMimeValue(rawContentType) || undefined;
            const contentRange = getHeaderString(response.headers, 'content-range');
            const acceptRanges =
              getHeaderString(response.headers, 'accept-ranges')?.toLowerCase() ?? '';
            const totalFromRange = parseContentRangeTotal(contentRange);
            const totalFromLen =
              response.statusCode === 200
                ? parseContentLength(getHeaderString(response.headers, 'content-length'))
                : undefined;
            const bytes = totalFromRange ?? totalFromLen;
            const ranges =
              response.statusCode === 206 ||
              acceptRanges === 'bytes' ||
              Boolean(contentRange);

            asset.probe = {
              status: 'verified',
              reason: 'ok',
              httpStatus: response.statusCode,
              mime,
              bytes,
              ranges,
            };

            if (typeof bytes === 'number') {
              asset.bytes = bytes;
            }
            if (mime && !isGenericMime(mime)) {
              asset.mime = mime;
              asset.kind = classifyAsset({
                url: asset.url,
                hint: asset.hint,
                mime,
                typeAttr: asset.typeAttr,
              });
            } else if (!asset.mime && mime) {
              asset.mime = mime;
            }
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
